import { requireEntitledSession } from '../auth/guards';
import type { ChallengeDb } from '../auth/challenges';

export type FrontdoorEnv = { NATIVE_AUTH_ENABLED?: string; PORTFOLIO_ACCOUNTS_DB?: ChallengeDb };
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
const deny = (status: number, text: string) => new Response(text, { status, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });

/** Public education and authentication shells contain no account data. All
 * other HTML, export data and unknown paths require a real entitled session.
 * The API handlers retain their own authentication, CSRF and response contracts.
 * Access remains separately required for the explicit legacy/claim bridge. */
export async function frontdoorAdmission(request: Request, env: FrontdoorEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const p = url.pathname;
  // Reject noncanonical encodings rather than letting CDN/asset routing and the
  // authorization layer interpret them differently. Queries never choose policy.
  if (/%|\\|\/\//.test(p)) return deny(400, 'Invalid path.');
  if (p === '/api' || p.startsWith('/api/')) return null;
  if (p === '/dev' || p.startsWith('/dev/')) return deny(404, 'Not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'Use GET or HEAD.');
  // Only executable/style/font assets here: no JSON, RSC, text, HTML or arbitrary
  // nested directories are exempted. _routes.json deliberately excludes nothing.
  if (p === '/sola-monogram.png') return null;
  if (/^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?|ttf)$/.test(p)) return null;
  const route = p.replace(/\/(?:index\.html)?$/, '').replace(/\.(?:html|txt)$/, '') || '/';
  if (['/', '/sign-in', '/create-account', '/onboarding', '/education', '/learn', '/start'].includes(route) || route.startsWith('/learn/') || route.startsWith('/start/')) return null;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB) return deny(503, 'Account access is unavailable.');
  try {
    const identity = await requireEntitledSession(request, env.PORTFOLIO_ACCOUNTS_DB);
    if (!(identity instanceof Response)) return null;
    if (identity.status === 403) return deny(403, 'This signed-in account is not invited. Open /sign-in/ to use an invited account.');
    // Native cookies are host-only. A different alias must sign in itself; no
    // session copy, URL token, Access-email mapping or cross-host redirect.
    if (p.endsWith('.txt') || request.headers.has('rsc') || request.headers.has('next-router-state-tree')) return deny(401, 'Sign in required.');
    const next = p + url.search;
    return new Response(null, { status: 302, headers: { ...headers, location: '/sign-in/?next=' + encodeURIComponent(next) } });
  } catch {
    return deny(503, 'Account access is unavailable.');
  }
}
