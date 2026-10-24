/**
 * Minimal, strict ABI helpers for Multicall3.aggregate3 (https://github.com/mds1/multicall3):
 *   struct Call3 { address target; bool allowFailure; bytes callData; }
 *   struct Result { bool success; bytes returnData; }
 *   function aggregate3(Call3[] calldata calls) returns (Result[] memory returnData)
 * No dependencies, no dynamic code. Decoding never trusts an offset or length it has not bounds-checked.
 */
export const SEL_AGGREGATE3 = '0x82ad56cb';
export const SEL_GET_ETH_BALANCE = '0x4d2301cc';
export const SEL_GET_BLOCK_NUMBER = '0x42cbb15c';
export const SEL_GET_CURRENT_BLOCK_TIMESTAMP = '0x0f28c97d';
export const SEL_BALANCE_OF = '0x70a08231';
export const SEL_DECIMALS = '0x313ce567';
export const SEL_LATEST_ROUND_DATA = '0xfeaf968c';

const w = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function addressWord(a: string): string {
  if (!ADDR.test(a)) throw new Error('bad address');
  return a.slice(2).toLowerCase().padStart(64, '0');
}

export type Call3 = { target: string; allowFailure: boolean; data: string };
export type Result3 = { success: boolean; data: string };

/** 0x-prefixed calldata for aggregate3(calls). */
export function encodeAggregate3(calls: Call3[]): string {
  const elems = calls.map((c) => {
    if (!ADDR.test(c.target) || !/^0x([0-9a-fA-F]{2})*$/.test(c.data)) throw new Error('bad call');
    const bytes = c.data.slice(2);
    const len = bytes.length / 2;
    const padded = bytes.padEnd(Math.ceil(len / 32) * 64, '0');
    return w(BigInt(c.target)) + w(c.allowFailure ? 1 : 0) + w(0x60) + w(len) + padded;
  });
  let off = calls.length * 32;
  const offsets: string[] = [];
  for (const e of elems) {
    offsets.push(w(off));
    off += e.length / 2;
  }
  return SEL_AGGREGATE3 + w(0x20) + w(calls.length) + offsets.join('') + elems.join('');
}

/** Decodes Result[]; returns null for anything malformed or out of bounds. Expects exactly `expected` results. */
export function decodeAggregate3(hex: string, expected: number): Result3[] | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const body = hex.slice(2);
  const size = body.length / 2;
  const read = (byteOff: number): bigint | null =>
    byteOff < 0 || byteOff + 32 > size
      ? null
      : BigInt('0x' + body.slice(byteOff * 2, (byteOff + 32) * 2));
  const arrOff = read(0);
  if (arrOff === null || arrOff !== 0x20n) return null;
  const n = read(0x20);
  if (n === null || n !== BigInt(expected)) return null;
  const base = 0x40; // start of the offsets table
  const out: Result3[] = [];
  for (let i = 0; i < expected; i++) {
    const rel = read(base + i * 32);
    if (rel === null || rel > BigInt(size)) return null;
    const el = base + Number(rel);
    const ok = read(el);
    const bOff = read(el + 32);
    if (ok === null || bOff === null || (ok !== 0n && ok !== 1n) || bOff > BigInt(size))
      return null;
    const bStart = el + Number(bOff);
    const len = read(bStart);
    if (len === null || len > BigInt(size)) return null;
    const l = Number(len);
    if (bStart + 32 + l > size) return null;
    out.push({
      success: ok === 1n,
      data: '0x' + body.slice((bStart + 32) * 2, (bStart + 32 + l) * 2),
    });
  }
  return out;
}
