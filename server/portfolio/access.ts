import { concatBytes } from './bytes';
// Cloudflare Access JWT verification (RS256) using WebCrypto. Fails closed.
export type AccessConfig = { teamDomain: string; aud: string };
export type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
export type KeyFetcher = (teamDomain: string, forceRefresh?: boolean) => Promise<Jwk[]>;

const b64u = (s: string) =>
  Uint8Array.from(
    atob(
      s
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(s.length / 4) * 4, '='),
    ),
    (c) => c.charCodeAt(0),
  );
const json = (s: string) =>
  JSON.parse(new TextDecoder().decode(b64u(s))) as Record<string, unknown>;

export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  fetchKeys: KeyFetcher,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    if (!token || token.length > 8192) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = json(parts[0]!);
    const payload = json(parts[1]!);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || 'crit' in header) return false;
    if (payload.iss !== `https://${cfg.teamDomain}`) return false;
    const aud = payload.aud;
    if (!(Array.isArray(aud) ? aud.includes(cfg.aud) : aud === cfg.aud)) return false;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return false;
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return false;
    const find = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    let jwk = find(await fetchKeys(cfg.teamDomain));
    if (!jwk) jwk = find(await fetchKeys(cfg.teamDomain, true)); // rotated key: one rate-limited refresh
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64u(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

const MAX_CERTS_BYTES = 32 * 1024;
const MAX_KEYS = 10;
const CERTS_TTL_MS = 60 * 60 * 1000;
const MAX_STALE_MS = 6 * 60 * 60 * 1000; // past this, fail closed instead of trusting old keys
const ATTEMPT_COOLDOWN_MS = 60 * 1000; // applies to every attempt, failed or not
const FETCH_DEADLINE_MS = 3000;

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      onTimeout();
      rej(new Error('deadline'));
    }, ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export function makeKeyFetcher(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  deadlineMs = FETCH_DEADLINE_MS,
): KeyFetcher {
  const cache = new Map<string, { keys: Jwk[]; at: number }>();
  const lastAttempt = new Map<string, number>();
  const inflight = new Map<string, Promise<Jwk[]>>();

  async function load(teamDomain: string): Promise<Jwk[]> {
    const ctl = new AbortController();
    const run = (async () => {
      const r = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`, {
        signal: ctl.signal,
        redirect: 'error',
      });
      if (!r.ok || !r.body) throw new Error('certs');
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_CERTS_BYTES) {
          await reader.cancel();
          throw new Error('certs too large');
        }
        chunks.push(value);
      }
      const parsed = JSON.parse(new TextDecoder().decode(concatBytes(chunks))) as { keys?: Jwk[] };
      return (parsed.keys ?? [])
        .filter(
          (k) =>
            k &&
            k.kty === 'RSA' &&
            typeof k.kid === 'string' &&
            typeof k.n === 'string' &&
            typeof k.e === 'string',
        )
        .slice(0, MAX_KEYS);
    })();
    return withDeadline(run, deadlineMs, () => ctl.abort());
  }

  return async (teamDomain, force = false) => {
    const t = now();
    const hit = cache.get(teamDomain);
    const fresh = hit && t - hit.at < CERTS_TTL_MS;
    if (fresh && !force) return hit.keys;
    const running = inflight.get(teamDomain);
    if (running) return running;
    const usableStale = hit && t - hit.at < MAX_STALE_MS ? hit.keys : null;
    const last = lastAttempt.get(teamDomain);
    if (last !== undefined && t - last < ATTEMPT_COOLDOWN_MS) {
      if (usableStale) return usableStale;
      throw new Error('cooldown');
    }
    lastAttempt.set(teamDomain, t);
    const p = load(teamDomain)
      .then((keys) => {
        cache.set(teamDomain, { keys, at: now() });
        return keys;
      })
      .catch((e) => {
        if (usableStale) return usableStale;
        throw e;
      })
      .finally(() => inflight.delete(teamDomain));
    inflight.set(teamDomain, p);
    return p;
  };
}

export const fetchAccessKeys: KeyFetcher = makeKeyFetcher();
