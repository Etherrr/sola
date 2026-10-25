import { readBounded } from '../portfolio/handler';
import { decodeJwt } from 'jose';
import { checkAccessJwt, isValidTeamHost, type KeyFetcher } from '../portfolio/access';
import { createD1Store, type D1Like } from './d1';
import { createLimiter, MUTATION_WINDOWS, type LimitCheck } from './limiter';
import { createD1Limiter } from './d1-limiter';
import { ownerKey, parseEntry, MAX_PER_NETWORK, type AccountsStore } from './store';

/**
 * Account-scoped saved address lists (design: docs/PORTFOLIO_ACCOUNTS_DESIGN.md).
 * DEFAULT OFF in two independent ways: PORTFOLIO_ACCOUNTS must be exactly '1' AND a D1
 * binding must be present. Neither exists in production today, so this endpoint answers
 * 503 'disabled' everywhere; the memory store exists for local tests only and is never
 * used to serve real requests.
 */
export type AccountsEnv = {
  PORTFOLIO_ACCOUNTS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  PORTFOLIO_ACCOUNTS_DB?: D1Like;
};
export type AccountsDeps = {
  fetchKeys: KeyFetcher;
  now: () => Date;
  id: () => string;
  bodyDeadlineMs: number;
  /** Test seam: when set, used instead of the D1 binding. Production code never sets this. */
  storeOverride?: AccountsStore;
  limiter?: { check(key: string): LimitCheck };
  /** Test seam for the durable layer: async counter check (e.g. D1-backed). */
  asyncLimiter?: { check(key: string): Promise<LimitCheck> };
};

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
};
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, code: string, message: string, requestId: string, extra: Record<string, string> = {}) =>
  reply(status, { error: { code, message }, requestId }, extra);

/**
 * Reads iss+sub from a token that has ALREADY passed checkAccessJwt, returning the storage
 * owner key. Never call on an unverified token; returns no other claim. A service token with
 * no user subject yields null.
 */
export function readOwnerKey(token: string | null): string | null {
  if (!token) return null;
  try {
    const claims = decodeJwt(token);
    return ownerKey(claims.iss, claims.sub);
  } catch {
    return null;
  }
}

const MAX_BODY = 2048;

const mutationLimiter = createLimiter(MUTATION_WINDOWS);
let lastMutSweepAt = 0;

export async function handleAccounts(
  req: Request,
  env: AccountsEnv,
  d: AccountsDeps,
): Promise<Response> {
  const requestId = d.id();
  // Pre-auth 503 matches the existing resolve handler's contract (its gate also returns
  // 'disabled'/'not_configured' before authentication). Both endpoints sit behind Cloudflare
  // Access at the edge, so these categories reach only Access-admitted callers; they reveal
  // feature existence/configuration state by design, same as the production resolve API.
  if (env.PORTFOLIO_ACCOUNTS !== '1' || (!env.PORTFOLIO_ACCOUNTS_DB && !d.storeOverride))
    return err(503, 'disabled', 'This feature is switched off.', requestId);
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !isValidTeamHost(env.ACCESS_TEAM_DOMAIN))
    return err(503, 'not_configured', 'Access verification is not configured.', requestId);
  const token = req.headers.get('cf-access-jwt-assertion');
  const reason = await checkAccessJwt(
    token,
    { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD },
    d.fetchKeys,
    Math.floor(d.now().getTime() / 1000),
  );
  if (reason !== null) return err(401, 'unauthorized', 'Authentication required.', requestId);
  const owner = readOwnerKey(token);
  if (!owner) return err(401, 'unauthorized', 'Authentication required.', requestId);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin)
    return err(403, 'bad_origin', 'Cross-origin requests are not allowed.', requestId);

  const store = d.storeOverride ?? createD1Store(env.PORTFOLIO_ACCOUNTS_DB as D1Like);
  const nowIso = d.now().toISOString();

  if (req.method === 'GET') {
    const rows = await store.list(owner);
    return reply(200, {
      requestId,
      accounts: rows,
      limits: { maxPerNetwork: MAX_PER_NETWORK },
    });
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    const lim = (d.limiter ?? mutationLimiter).check(owner);
    let blocked = lim.allowed ? null : lim;
    // Durable global layer when the real binding serves this request (never in storeOverride tests
    // unless the test injects an asyncLimiter): atomic UPSERT, UTC windows, fails closed.
    if (!blocked && !d.storeOverride && env.PORTFOLIO_ACCOUNTS_DB) {
      const global = await createD1Limiter(env.PORTFOLIO_ACCOUNTS_DB, MUTATION_WINDOWS, 'mutation').check(owner);
      if (!global.allowed) blocked = global;
      else if (Date.now() - lastMutSweepAt > 3_600_000) {
        lastMutSweepAt = Date.now();
        await createD1Limiter(env.PORTFOLIO_ACCOUNTS_DB, MUTATION_WINDOWS, 'mutation').sweep(2 * 86_400_000);
      }
    }
    if (!blocked && d.asyncLimiter) {
      const injected = await d.asyncLimiter.check(owner);
      if (!injected.allowed) blocked = injected;
    }
    if (blocked)
      return err(429, 'rate_limited', 'Too many changes. Try again later.', requestId, {
        'retry-after': String(blocked.retryAfterSec),
      });
    if (!/^application\/json\s*(;.*)?$/i.test(req.headers.get('content-type') ?? ''))
      return err(415, 'unsupported_media_type', 'Send application/json.', requestId);
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY)
      return err(413, 'body_too_large', 'Request body is too large.', requestId);
    let body: unknown;
    try {
      const text = await readBounded(req, MAX_BODY, d.bodyDeadlineMs);
      if (text === null) return err(413, 'body_too_large', 'Request body is too large.', requestId);
      body = JSON.parse(text);
    } catch (e) {
      if (e instanceof Error && e.message === 'body deadline')
        return err(408, 'body_timeout_or_error', 'Could not read the request body in time.', requestId);
      return err(400, 'bad_json', 'Body must be valid JSON.', requestId);
    }

    if (req.method === 'POST') {
      const entry = parseEntry(body);
      if (!entry) return err(400, 'bad_entry', 'Network, address or label is not usable.', requestId);
      const res = await store.add(owner, entry, nowIso);
      if (!res.ok)
        return err(409, 'cap_reached', `At most ${MAX_PER_NETWORK} saved addresses per network.`, requestId);
      return reply(200, { requestId, account: res.entry });
    }

    // DELETE {network,address} removes one; DELETE {all:true} clears the owner's saved data.
    const b = body as Record<string, unknown> | null;
    if (b && b.all === true) {
      await store.clear(owner);
      return reply(200, { requestId, cleared: true });
    }
    const entry = parseEntry({ network: b?.network, address: b?.address, label: 'x' });
    if (!entry) return err(400, 'bad_entry', 'Network or address is not usable.', requestId);
    await store.remove(owner, entry.network, entry.address);
    return reply(200, { requestId, removed: true });
  }

  return err(405, 'method_not_allowed', 'Use GET, POST or DELETE.', requestId, {
    allow: 'GET, POST, DELETE',
  });
}
