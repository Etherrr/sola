import { checkAccessJwt, fetchAccessKeys, isValidTeamHost, type KeyFetcher } from '../portfolio/access';
import { sharedOverviewCache, createOverviewCache } from './overview';

/**
 * HTTP boundary for the Markets overview. Gate order mirrors the portfolio route: kill switch,
 * then Cloudflare Access JWT (never an email header), then same-origin checks. Fails closed.
 * The route is read-only public market data: no wallet addresses, no account data, nothing
 * user-specific is accepted, logged or sent anywhere.
 */
export type Env = {
  /** Only the exact string '1' turns the route on; anything else keeps Markets unavailable. */
  MARKETS_OVERVIEW?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

export type Deps = {
  fetchKeys: KeyFetcher;
  now: () => Date;
  id: () => string;
  cache: ReturnType<typeof createOverviewCache>;
};

export const defaultDeps = (): Deps => ({
  fetchKeys: fetchAccessKeys,
  now: () => new Date(),
  id: () => crypto.randomUUID(),
  cache: sharedOverviewCache(),
});

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
const err = (status: number, code: string, message: string, requestId: string) =>
  reply(status, { error: { code, message }, requestId });

/** At most one log line per category per minute per isolate, so rejections cannot amplify logs. */
const lastLogged = new Map<string, number>();
function logOnce(category: string, nowMs: number) {
  const last = lastLogged.get(category);
  if (last !== undefined && nowMs - last < 60_000) return;
  lastLogged.set(category, nowMs);
  console.warn(category);
}

export async function handleOverview(
  req: Request,
  env: Env,
  d: Deps = defaultDeps(),
): Promise<Response> {
  const requestId = d.id();
  if (req.method !== 'GET')
    return err(405, 'method_not_allowed', 'Use GET.', requestId);
  if (env.MARKETS_OVERVIEW !== '1')
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
  if (reason !== null) {
    logOnce(`auth_reject:${reason}`, d.now().getTime()); // finite category only
    return err(401, 'unauthorized', 'Authentication required.', requestId);
  }
  // Same-origin only: a mismatched Origin, or any cross-site fetch metadata, is rejected.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin)
    return err(403, 'bad_origin', 'Cross-origin requests are not allowed.', requestId);
  if ((req.headers.get('sec-fetch-site') ?? 'same-origin') === 'cross-site')
    return err(403, 'bad_origin', 'Cross-origin requests are not allowed.', requestId);

  const force = new URL(req.url).searchParams.get('refresh') === '1';
  const outcome = await d.cache.read(force);
  if (outcome.kind === 'unavailable')
    return err(502, 'source_unavailable', 'The price source is unavailable. Nothing was substituted.', requestId);
  return reply(200, { schemaVersion: 1, ...outcome.result });
}
