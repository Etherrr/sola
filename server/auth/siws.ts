/**
 * SIWS (Sign In With Solana) message construction and ed25519 verification for
 * wallet_solana sign-in (v0.2 preview).
 *
 * Format binding (docs/V0_2_ARCHITECTURE.md §3): exactly ONE expected message
 * format - the plain Wallet Standard SIWS text this module builds. The server
 * binds the format to the issued challenge; any other envelope rejects.
 * Message-signature gate only - NEVER a transaction signature.
 * Solana addresses are case-sensitive base58; compare EXACTLY.
 */
import { ed25519 } from '@noble/curves/ed25519';

export interface SiwsFields {
  domain: string;
  address: string; // base58, case-sensitive
  uri: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return null;
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = new Uint8Array(hex.length / 2);
  for (let i = 0; i < body.length; i++) body[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const leading = s.match(/^1+/)?.[0].length ?? 0;
  const out = new Uint8Array(leading + body.length);
  out.set(body, leading);
  return out;
}

/** A Solana public key is 32 bytes, base58-encoded (32-44 chars). */
export function isValidSolanaAddress(address: string): boolean {
  if (address.length < 32 || address.length > 44) return false;
  const decoded = base58Decode(address);
  return decoded !== null && decoded.length === 32;
}

/** The single bound SIWS message format (plain Wallet Standard style). */
export function buildSiwsMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    '',
    'Sign in to Sola.',
    '',
    `URI: ${f.uri}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join('\n');
}

export type SiwsVerify =
  | { ok: true; fields: SiwsFields }
  | { ok: false; error: 'bad_message' | 'bad_signature' | 'domain_mismatch' | 'uri_mismatch' | 'nonce_mismatch' | 'expired' | 'address_mismatch' };

export function verifySiwsMessage(
  message: string,
  signature: Uint8Array,
  expected: { domain: string; uri: string; nonce: string; address: string },
  now: Date = new Date(),
): SiwsVerify {
  const m = message.match(
    /^([^\n]+) wants you to sign in with your Solana account:\n([^\n]+)\n\nSign in to Sola\.\n\nURI: ([^\n]+)\nNonce: ([^\n]+)\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/,
  );
  if (!m) return { ok: false, error: 'bad_message' };
  const fields: SiwsFields = {
    domain: m[1], address: m[2], uri: m[3], nonce: m[4], issuedAt: m[5], expirationTime: m[6],
  };
  if (!isValidSolanaAddress(fields.address)) return { ok: false, error: 'bad_message' };
  if (fields.domain !== expected.domain) return { ok: false, error: 'domain_mismatch' };
  if (fields.uri !== expected.uri) return { ok: false, error: 'uri_mismatch' };
  if (fields.nonce !== expected.nonce) return { ok: false, error: 'nonce_mismatch' };
  // Solana addresses are case-sensitive: EXACT comparison only.
  if (fields.address !== expected.address) return { ok: false, error: 'address_mismatch' };
  const exp = Date.parse(fields.expirationTime);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return { ok: false, error: 'expired' };
  const pub = base58Decode(fields.address);
  if (!pub || signature.length !== 64) return { ok: false, error: 'bad_signature' };
  try {
    if (!ed25519.verify(signature, new TextEncoder().encode(message), pub))
      return { ok: false, error: 'bad_signature' };
  } catch {
    return { ok: false, error: 'bad_signature' };
  }
  return { ok: true, fields };
}
