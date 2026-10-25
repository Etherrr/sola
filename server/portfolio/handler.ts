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
import { mockProvider, solanaMockProvider, type Diag, type PortfolioProvider } from './provider';
import { createLimiter, LOOKUP_WINDOWS } from '../accounts/limiter';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { D1Like } from '../accounts/d1';
import { readOwnerKey } from '../accounts/handler';
import { createLiveProvider } from './live-provider';
import { createSolanaLiveProvider } from './live-provider-solana';

export type Env = {
  PORTFOLIO_API_ENABLED?: string;
  /** Live read-only data. Only the exact string '1' turns it on; anything else keeps the simulated fixtures. */
  PORTFOLIO_LIVE_DATA?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Optional per-identity lookup limiter. Only the exact string '1' turns it on. */
  PORTFOLIO_LOOKUP_LIMIT?: string;
  /** Optional approved D1 binding; when present the limiter adds a durable global counter layer. */
  PORTFOLIO_ACCOUNTS_DB?: D1Like;
  /** Aave V3 read-only positions on Ethereum lookups. Only the exact string '1' turns it on. */
  PORTFOLIO_AAVE_V3?: string;
};
export type Deps = {
  provider: PortfolioProvider;
  liveProvider: PortfolioProvider;
  solanaProvider: PortfolioProvider;
  solanaLiveProvider: PortfolioProvider;
  fetchKeys: KeyFetcher;
  now: () => Date;
  id: () => string;
  timeoutMs: number;
  bodyDeadlineMs: number;
};

export const defaultDeps = (): Deps => ({
  provider: mockProvider,
  liveProvider: createLiveProvider(),
  solanaProvider: solanaMockProvider,
  solanaLiveProvider: createSolanaLiveProvider(),
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
export async function readBounded(
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
const lookupLimiter = createLimiter(LOOKUP_WINDOWS);
let lastSweepAt = 0;
const d1Limiters = new WeakMap<object, ReturnType<typeof createD1Limiter>>();
function d1LimiterFor(db: D1Like) {
  let l = d1Limiters.get(db as object);
  if (!l) {
    l = createD1Limiter(db, LOOKUP_WINDOWS, 'lookup');
    d1Limiters.set(db as object, l);
  }
  return l;
}
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
  // Optional first-layer per-identity limit (per-isolate, best-effort; the durable global
  // counter reuses the approved D1 binding). Off unless the flag is exactly '1'. The client
  // already honors 429 Retry-After. The key is the verified iss#sub, never an email or token.
  if (env.PORTFOLIO_LOOKUP_LIMIT === '1') {
    const key = readOwnerKey(req.headers.get('cf-access-jwt-assertion'));
    // Fail closed: with the limiter enabled, an authenticated token WITHOUT a user subject
    // (e.g. a service token) cannot be accounted for, so it is denied rather than throttled
    // into an unbounded identity class (reviewer safety finding).
    if (!key) return err(401, 'unauthorized', 'Authentication required.', requestId);
    {
      // Layer 1: per-isolate memory. Alone it is NOT a global guardrail: distributed Pages
      // instances each hold their own counters. Layer 2 (only with the approved D1 binding):
      // one atomic UPSERT per window, UTC-aligned, failing CLOSED on any storage error.
      const lim = lookupLimiter.check(key);
      let blocked = lim.allowed ? null : lim;
      if (!blocked && env.PORTFOLIO_ACCOUNTS_DB) {
        const global = await d1LimiterFor(env.PORTFOLIO_ACCOUNTS_DB).check(key);
        if (!global.allowed) blocked = global;
        const t = d.now().getTime();
        if (t - lastSweepAt > 3_600_000) {
          lastSweepAt = t;
          // Awaited, not fire-and-forget: a returned response can terminate the isolate
          // before a detached cleanup completes (reviewer finding 3). One indexed DELETE.
          await d1LimiterFor(env.PORTFOLIO_ACCOUNTS_DB).sweep(2 * 86_400_000);
        }
      }
      if (blocked)
        return err(429, 'rate_limited', 'Too many lookups. Try again later.', requestId, {
          'retry-after': String(blocked.retryAfterSec),
        });
    }
  }
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
      (parsed.value.network === 'solana'
        ? env.PORTFOLIO_LIVE_DATA === '1'
          ? d.solanaLiveProvider
          : d.solanaProvider
        : pick(env, d)
      ).fetchWallets(parsed.value.addresses, ctl.signal, {
        aave: parsed.value.network === 'ethereum' && env.PORTFOLIO_AAVE_V3 === '1',
      }),
      new Promise<never>((_, rej) =>
        ctl.signal.addEventListener('abort', () => rej(new Error('timeout'))),
      ),
    ]);
  } catch {
    // Both paths fall through to the one failure branch below, so every failed lookup is logged.
    result = (
      ctl.signal.aborted
        ? { ok: false, provider: 'unknown', kind: 'timeout', diag: { step: 'timeout' } }
        : // An unexpected throw inside a provider is a bad response, not a timeout.
          { ok: false, provider: 'unknown', kind: 'bad_response', diag: { step: 'exception' } }
    ) as never;
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
    chainId: parsed.value.network === 'ethereum' ? 1 : null,
    network: parsed.value.network,
    mode: result.simulated ? 'mock' : 'live',
    simulated: result.simulated,
    wallets: result.wallets,
    totals: {
      recognizedPricedSubtotalUsd: subtotal === null ? null : fmt(subtotal),
      unpricedAssetCount: unpriced,
      note:
        parsed.value.network === 'ethereum' && env.PORTFOLIO_AAVE_V3 === '1'
          ? 'Wallet balances only: DeFi deposits, staking, debts, LP claims and other positions may be missing; Aave V3 positions are listed separately and are never added to this subtotal; the subtotal is not total net worth.'
          : 'Wallet balances only: DeFi deposits, staking, debts, LP claims and other positions may be missing; the subtotal is not total net worth.',
    },
    partial: result.wallets.some((w) => w.partial),
    warnings: result.simulated
      ? ['SIMULATED fixture data. Not read from any blockchain.']
      : parsed.value.network === 'solana'
        ? [
            'Live read-only Solana data. Only the SOL balance is checked; SPL tokens (including USDC and USDT), NFTs and DeFi positions are not shown. A missing token is not a zero balance.',
          ]
        : env.PORTFOLIO_AAVE_V3 === '1'
          ? [
              'Live read-only Ethereum data. Wallet balances cover only ETH, USDC, USDT, DAI and WETH; Aave V3 shows supplied and variable-debt positions only (no stable debt, health factor or APY). Other tokens, NFTs and other DeFi positions are not shown.',
            ]
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
  return reply(200, {
    status: 'ok',
    mode: pick(env, d).simulated ? 'mock' : 'live',
    aave: env.PORTFOLIO_AAVE_V3 === '1',
    requestId,
  });
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
    networks: [
      { id: 'ethereum', chainId: 1, status: pick(env, d).simulated ? 'mock' : 'live' },
      { id: 'solana', chainId: null, status: pick(env, d).simulated ? 'mock' : 'live' },
    ],
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
