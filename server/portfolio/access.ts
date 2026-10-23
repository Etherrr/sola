// Cloudflare Access JWT verification (RS256) using WebCrypto. Fails closed.
export type AccessConfig = { teamDomain: string; aud: string };
export type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
export type KeyFetcher = (teamDomain: string) => Promise<Jwk[]>;

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
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = json(parts[0]!);
    const payload = json(parts[1]!);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    if (payload.iss !== `https://${cfg.teamDomain}`) return false;
    const aud = payload.aud;
    if (!(Array.isArray(aud) ? aud.includes(cfg.aud) : aud === cfg.aud)) return false;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return false;
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return false;
    const jwk = (await fetchKeys(cfg.teamDomain)).find(
      (k) => k.kid === header.kid && k.kty === 'RSA',
    );
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

export const fetchAccessKeys: KeyFetcher = async (teamDomain) => {
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 3600 },
  } as RequestInit);
  if (!r.ok) throw new Error('certs');
  return ((await r.json()) as { keys: Jwk[] }).keys;
};
