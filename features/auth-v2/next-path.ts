/**
 * Validates the sign-in resume destination (?next=). Strict on purpose:
 * only a same-origin absolute path survives - anything that could become an
 * open redirect (scheme, authority, protocol-relative, backslash, ANY percent
 * encoding, traversal) falls back. Rejecting '%' wholesale kills encoded
 * forms (%2f, %5c, double-encoding) without a decode arms race.
 */
export const DEFAULT_NEXT = '/account/overview';

const ALLOWED = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/?]*$/;

export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_NEXT): string {
  if (!raw) return fallback;
  if (raw.length > 200) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.includes('\\') || raw.includes('%') || raw.includes('..')) return fallback;
  if (!ALLOWED.test(raw)) return fallback;
  return raw;
}
