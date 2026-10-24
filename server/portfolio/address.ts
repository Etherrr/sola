import { keccak256Utf8 } from './keccak';

export type AddressCheck =
  { ok: true; address: string } | { ok: false; reason: 'format' | 'checksum' };

export function toChecksumAddress(hex40: string): string {
  const lower = hex40.toLowerCase();
  const hash = keccak256Utf8(lower);
  let out = '0x';
  for (let i = 0; i < 40; i++)
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

/** Accepts 0x + 40 hex. All-lowercase or all-uppercase hex is accepted without a checksum;
 *  mixed case must match EIP-55. Returns the canonical checksummed form. */
export function checkEvmAddress(input: unknown): AddressCheck {
  if (typeof input !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(input))
    return { ok: false, reason: 'format' };
  const body = input.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  const canonical = toChecksumAddress(body);
  if (mixed && canonical !== input) return { ok: false, reason: 'checksum' };
  return { ok: true, address: canonical };
}

// Base58 alphabet (Bitcoin/Solana): no 0, O, I or l.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Accepts a Solana mainnet address: base58, 32 to 44 characters (a 32-byte public key is
 *  typically 43-44 chars; shorter encodings of 32-byte keys are valid). No checksum exists
 *  on Solana, so a malformed string can only be rejected by shape, never proven wrong. */
export function checkSolanaAddress(input: unknown): AddressCheck {
  if (typeof input !== 'string' || input.length < 32 || input.length > 44 || !BASE58.test(input))
    return { ok: false, reason: 'format' };
  return { ok: true, address: input };
}
