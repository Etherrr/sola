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
