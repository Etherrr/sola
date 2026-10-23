// Minimal Keccak-256 (the original Keccak padding used by Ethereum, not NIST SHA3).
// Only used to verify EIP-55 address checksums. Checked against known vectors in tests.
const MASK = (1n << 64n) - 1n;
const RC: bigint[] = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const rotl = (x: bigint, n: number) =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function permute(s: bigint[]) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!);
    const d = [0, 1, 2, 3, 4].map((x) => c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1));
    for (let i = 0; i < 25; i++) s[i] = s[i]! ^ d[i % 5]!;
    const b: bigint[] = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y]!, ROT[x]![y]!);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] =
          b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK & b[((x + 2) % 5) + 5 * y]!);
    s[0] = s[0]! ^ RC[round]!;
  }
}

export function keccak256Hex(input: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;
  const s: bigint[] = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]!);
      s[i] = s[i]! ^ lane;
    }
    permute(s);
  }
  let out = '';
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 8; j++)
      out += Number((s[i]! >> BigInt(8 * j)) & 0xffn)
        .toString(16)
        .padStart(2, '0');
  return out;
}

export const keccak256Utf8 = (text: string) => keccak256Hex(new TextEncoder().encode(text));
