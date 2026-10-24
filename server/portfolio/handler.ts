import { concatBytes } from './bytes';
import { parseResolveRequest, MAX_BODY_BYTES, type ResolveResponse } from './contract';
import {
  checkAccessJwt,
  fetchAccessKeys,
  isValidTeamHost,
  readEmailClaim,
  readExpiresAt,
  type KeyFetcher,
} from './access';
import { mockProvider, type Diag, type PortfolioProvider } from './provider';
import { createLiveProvider } from './live-provider';

export type Env = {
  PORTFOLIO_API_ENABLED?: string;
  /** Live read-only data. Only the exact string '1' turns it on; anything else keeps the simulated fixtures. */
  PORTFOLIO_LIVE_DATA?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};
export type Deps = {
  provider: PortfolioProvider;
  liveProvider: PortfolioProvider;
  fetchKeys: KeyFetcher;
  now: () => Date;
  id: () => string;
  timeoutMs: number;
  bodyDeadlineMs: number;
};

export const defaultDeps = (): Deps => ({
  provider: mockProvider,
  liveProvider: createLiveProvider(),
  fetchKeys: fetchAccessKeys,
  now: () => new Date(),
  id: () => crypto.randomUUID(),
  timeoutMs: 8000,
  bodyDeadlineMs: 3000,
});

/** The provider for this request: simulated unless the kill switch is exactly '1'. */
const pick = (env: Env, d: Deps) => (env.PORTFOLIO_LIVE_DATA === '1' ? d.liveProvider : d.provider);

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
const err = (
  status: number,
  code: string,
  message: string,
  requestId: string,
  extra: Record<string, string> = {},
  diagnostic?: Diag,
) =>
  reply(
    status,
    { error: { code, message }, requestId, ...(diagnostic ? { diagnostic } : {}) },
    extra,
  );

/** Reads at most `limit` bytes of the body; returns null as soon as it is exceeded (never buffers more). */
async function readBounded(
  req: Request,
  limit: number,
  deadlineMs: number,
): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      rej(new Error('body deadline'));
    }, deadlineMs);
  });
  try {
    return await Promise.race([readAll(reader, limit), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concatBytes(chunks));
}

/** Gate every request: kill switch, then Access JWT (never trust an email header). Fails closed. */
const lastLogged = new Map<string, number>();
/** At most one log line per category per minute per isolate, so rejections cannot amplify log volume. */
function logOnce(category: string, nowMs: number) {
  const last = lastLogged.get(category);
  if (last !== undefined && nowMs - last < 60_000) return;
  lastLogged.set(category, nowMs);
  console.warn(category);
}

async function gate(req: Request, env: Env, d: Deps, requestId: string): Promise<Response | null> {
  if (env.PORTFOLIO_API_ENABLED !== 'true')
    return err(503, 'disabled', 'This feature is switched off.', requestId);
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    return err(503, 'not_configured', 'Access verification is not configured.', requestId);
  if (!isValidTeamHost(env.ACCESS_TEAM_DOMAIN)) {
    logOnce('auth_config:team_host_invalid', d.now().getTime());
    return err(503, 'not_configured', 'Access verification is not configured.', requestId);
  }
  const reason = await checkAccessJwt(
    req.headers.get('cf-access-jwt-assertion'),
    { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD },
    d.fetchKeys,
    Math.floor(d.now().getTime() / 1000),
  );
  if (reason === null) return null;
  logOnce(`auth_reject:${reason}`, d.now().getTime()); // finite category only: no token, claim value, email or address
  return err(401, 'unauthorized', 'Authentication required.', requestId);
}

export async function handleResolve(
  req: Request,
  env: Env,
  d: Deps = defaultDeps(),
): Promise<Response> {
  const requestId = d.id();
  if (req.method !== 'POST')
    return err(405, 'method_not_allowed', 'Use POST.', requestId, { allow: 'POST' });
  const blocked = await gate(req, env, d, requestId);
  if (blocked) return blocked;
  if (!/^application\/json\s*(;.*)?$/i.test(req.headers.get('content-type') ?? ''))
    return err(415, 'unsupported_media_type', 'Send application/json.', requestId);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin)
    return err(403, 'bad_origin', 'Cross-origin requests are not allowed.', requestId);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return err(413, 'body_too_large', 'Request body is too large.', requestId);
  let text: string | null;
  try {
    text = await readBounded(req, MAX_BODY_BYTES, d.bodyDeadlineMs);
  } catch {
    return err(408, 'body_timeout_or_error', 'Could not read the request body in time.', requestId);
  }
  if (text === null) return err(413, 'body_too_large', 'Request body is too large.', requestId);
  const parsed = parseResolveRequest(text);
  if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, requestId);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), d.timeoutMs);
  let result;
  try {
    result = await Promise.race([
      pick(env, d).fetchWallets(parsed.value.addresses, ctl.signal),
      new Promise<never>((_, rej) =>
        ctl.signal.addEventListener('abort', () => rej(new Error('timeout'))),
      ),
    ]);
  } catch {
    if (ctl.signal.aborted)
      return err(
        504,
        'provider_timeout',
        'The data source took too long. No data was substituted.',
        requestId,
      );
    // An unexpected throw inside a provider is a bad response, not a timeout.
    result = { ok: false, provider: 'unknown', kind: 'bad_response' } as never;
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok) {
    const dg = result.diag;
    // Numbers and fixed step names only: no address, payload, URL or provider text.
    console.warn(JSON.stringify({ evt: 'provider_failure', requestId, kind: result.kind, ...dg }));
    if (result.kind === 'rate_limited')
      return err(
        429,
        'rate_limited',
        'The data source is rate limiting. Try again later.',
        requestId,
        { 'retry-after': '30' },
        dg,
      );
    if (result.kind === 'timeout')
      return err(
        504,
        'provider_timeout',
        'The data source took too long. No data was substituted.',
        requestId,
        {},
        dg,
      );
    if (result.kind === 'bad_response')
      return err(
        502,
        'provider_bad_response',
        'The data source returned an unusable answer.',
        requestId,
        {},
        dg,
      );
    return err(
      503,
      'provider_unavailable',
      'The data source is unavailable. No data was substituted.',
      requestId,
      {},
      dg,
    );
  }
  let subtotal: bigint | null = null; // micro-USD
  let unpriced = 0;
  for (const w of result.wallets)
    for (const a of w.assets) {
      if (a.value === null) unpriced++;
      else {
        const [i, f = ''] = a.value.split('.');
        subtotal = (subtotal ?? 0n) + BigInt(i! + f.padEnd(6, '0'));
      }
    }
  const fmt = (v: bigint) => `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, '0')}`;
  const body: ResolveResponse = {
    schemaVersion: 1,
    requestId,
    generatedAt: d.now().toISOString(),
    observedAt: result.observedAt,
    provider: result.provider,
    chainId: 1,
    mode: result.simulated ? 'mock' : 'live',
    simulated: result.simulated,
    wallets: result.wallets,
    totals: {
      recognizedPricedSubtotalUsd: subtotal === null ? null : fmt(subtotal),
      unpricedAssetCount: unpriced,
      note: 'Wallet balances only: DeFi deposits, staking, debts, LP claims and other positions may be missing; the subtotal is not total net worth.',
    },
    partial: result.wallets.some((w) => w.partial),
    warnings: result.simulated
      ? ['SIMULATED fixture data. Not read from any blockchain.']
      : [
          'Live read-only Ethereum data. Only ETH, USDC, USDT, DAI and WETH are checked; other tokens, NFTs and DeFi positions are not shown.',
        ],
  };
  return reply(200, body);
}

export async function handleHealth(
  req: Request,
  env: Env,
  d: Deps = defaultDeps(),
): Promise<Response> {
  const requestId = d.id();
  if (req.method !== 'GET')
    return err(405, 'method_not_allowed', 'Use GET.', requestId, { allow: 'GET' });
  const blocked = await gate(req, env, d, requestId);
  if (blocked) return blocked;
  return reply(200, { status: 'ok', mode: pick(env, d).simulated ? 'mock' : 'live', requestId });
}

export async function handleNetworks(
  req: Request,
  env: Env,
  d: Deps = defaultDeps(),
): Promise<Response> {
  const requestId = d.id();
  if (req.method !== 'GET')
    return err(405, 'method_not_allowed', 'Use GET.', requestId, { allow: 'GET' });
  const blocked = await gate(req, env, d, requestId);
  if (blocked) return blocked;
  return reply(200, {
    networks: [{ id: 'ethereum', chainId: 1, status: pick(env, d).simulated ? 'mock' : 'live' }],
    requestId,
  });
}

/** Who Cloudflare Access says this browser session is. Same gate as every route; nothing is stored. */
export async function handleSession(
  req: Request,
  env: Env,
  d: Deps = defaultDeps(),
): Promise<Response> {
  const requestId = d.id();
  if (req.method !== 'GET')
    return err(405, 'method_not_allowed', 'Use GET.', requestId, { allow: 'GET' });
  const blocked = await gate(req, env, d, requestId);
  if (blocked) return blocked;
  const token = req.headers.get('cf-access-jwt-assertion');
  const email = readEmailClaim(token);
  return reply(200, {
    status: 'ok',
    via: 'cloudflare-access',
    identity: email === null ? null : { email },
    expiresAt: readExpiresAt(token),
    requestId,
  });
}
