/**
 * SIWE (EIP-4361) message construction, strict parsing and EIP-191 personal_sign
 * verification for wallet_evm sign-in (v0.2 preview).
 *
 * Scope limits (fail closed, documented in docs/V0_2_ARCHITECTURE.md §7):
 * - EOA ecrecover ONLY. ERC-1271 contract accounts and ERC-6492 undeployed accounts
 *   are NOT supported here; verification fails closed for them.
 * - Message-signature gate only: this verifies a sign-in message, NEVER a
 *   transaction or token-approval signature.
 * - The server binds the expected domain/URI/nonce/expiry to the issued challenge;
 *   any mismatch rejects. Chain id is policy-checked by the caller.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

export interface SiweFields {
  domain: string;
  address: string; // EIP-55 checksummed
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string; // ISO 8601
  expirationTime: string; // ISO 8601
}

const EIP55_RE = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 checksum encoding. */
export function toEip55(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = [...keccak_256(new TextEncoder().encode(lower))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** True when the address is a correctly checksummed EIP-55 string (or all-lowercase/all-uppercase, which EIP-55 permits). */
export function isValidEvmAddress(address: string): boolean {
  if (!EIP55_RE.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toEip55(address) === address;
}

/** Canonical EIP-4361 message text (statement-free, single expected format). */
export function buildSiweMessage(f: SiweFields): string {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    '',
    'Sign in to Sola.',
    '',
    `URI: ${f.uri}`,
    'Version: 1',
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join('\n');
}

/** Strict parse of the exact format buildSiweMessage emits. Any deviation rejects. */
export function parseSiweMessage(message: string): SiweFields | null {
  const m = message.match(
    /^([^\n]+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\nSign in to Sola\.\n\nURI: ([^\n]+)\nVersion: 1\nChain ID: (\d+)\nNonce: ([^\n]+)\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/,
  );
  if (!m) return null;
  return {
    domain: m[1],
    address: m[2],
    uri: m[3],
    chainId: Number(m[4]),
    nonce: m[5],
    issuedAt: m[6],
    expirationTime: m[7],
  };
}

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + message). */
export function personalSignDigest(message: string): Uint8Array {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  const joined = new Uint8Array(prefix.length + msg.length);
  joined.set(prefix);
  joined.set(msg, prefix.length);
  return keccak_256(joined);
}

export type SiweVerify =
  | { ok: true; fields: SiweFields }
  | { ok: false; error: 'bad_message' | 'bad_signature' | 'domain_mismatch' | 'uri_mismatch' | 'nonce_mismatch' | 'expired' | 'address_mismatch' | 'chain_mismatch' };

/**
 * Verify a SIWE message + EIP-191 signature against the expected bindings.
 * `expectedAddress` is compared EIP-55-normalized (hex is case-insensitive per the
 * entitlement gate rule); the recovered signer must equal the message's address.
 */
export function verifySiweMessage(
  message: string,
  signatureHex: string,
  expected: { domain: string; uri: string; nonce: string; chainId: number; address: string },
  now: Date = new Date(),
): SiweVerify {
  const fields = parseSiweMessage(message);
  if (!fields || !isValidEvmAddress(fields.address)) return { ok: false, error: 'bad_message' };
  if (fields.domain !== expected.domain) return { ok: false, error: 'domain_mismatch' };
  if (fields.uri !== expected.uri) return { ok: false, error: 'uri_mismatch' };
  if (fields.nonce !== expected.nonce) return { ok: false, error: 'nonce_mismatch' };
  if (fields.chainId !== expected.chainId) return { ok: false, error: 'chain_mismatch' };
  if (fields.address.toLowerCase() !== expected.address.toLowerCase()) return { ok: false, error: 'address_mismatch' };
  const exp = Date.parse(fields.expirationTime);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return { ok: false, error: 'expired' };
  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(signatureHex);
  } catch {
    return { ok: false, error: 'bad_signature' };
  }
  if (sigBytes.length !== 65) return { ok: false, error: 'bad_signature' };
  const recovery = sigBytes[64] >= 27 ? sigBytes[64] - 27 : sigBytes[64];
  if (recovery !== 0 && recovery !== 1) return { ok: false, error: 'bad_signature' };
  try {
    const sig = secp256k1.Signature.fromCompact(sigBytes.slice(0, 64)).addRecoveryBit(recovery);
    const pub = sig.recoverPublicKey(personalSignDigest(message)).toRawBytes(false).slice(1);
    const recovered = toEip55('0x' + [...keccak_256(pub)].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
    if (recovered.toLowerCase() !== fields.address.toLowerCase()) return { ok: false, error: 'bad_signature' };
  } catch {
    return { ok: false, error: 'bad_signature' };
  }
  return { ok: true, fields };
}
