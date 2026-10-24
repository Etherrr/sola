import { describe, expect, it } from 'vitest';
import { keccak256 } from './helpers/keccak';
import * as abi from '../server/portfolio/abi';

const sel = (sig: string) => '0x' + keccak256(sig).slice(0, 8);
describe('selectors are computed, not remembered', () => {
  it('keccak known vector', () => {
    expect(keccak256('')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(sel('transfer(address,uint256)')).toBe('0xa9059cbb');
  });
  it.each([
    ['aggregate3((address,bool,bytes)[])', abi.SEL_AGGREGATE3],
    ['getEthBalance(address)', abi.SEL_GET_ETH_BALANCE],
    ['getBlockNumber()', abi.SEL_GET_BLOCK_NUMBER],
    ['getCurrentBlockTimestamp()', abi.SEL_GET_CURRENT_BLOCK_TIMESTAMP],
    ['balanceOf(address)', abi.SEL_BALANCE_OF],
    ['decimals()', abi.SEL_DECIMALS],
    ['latestRoundData()', abi.SEL_LATEST_ROUND_DATA],
  ])('%s', (sig, c) => expect(sel(sig)).toBe(c));
});

const T = '0x' + 'cd'.repeat(20);
const enc = (rs: { success: boolean; data: string }[]) => {
  const w = (n: number) => n.toString(16).padStart(64, '0');
  const els = rs.map((r) => {
    const b = r.data.slice(2);
    return (
      w(r.success ? 1 : 0) +
      w(0x40) +
      w(b.length / 2) +
      b.padEnd(Math.ceil(b.length / 64) * 64, '0')
    );
  });
  let off = rs.length * 32;
  const offs = els.map((e) => {
    const o = off;
    off += e.length / 2;
    return w(o);
  });
  return '0x' + w(0x20) + w(rs.length) + offs.join('') + els.join('');
};
describe('aggregate3 codec', () => {
  it('encodes the documented layout', () => {
    const d = abi.encodeAggregate3([{ target: T, allowFailure: true, data: '0x12345678' }]);
    const body = d.slice(10);
    expect(d.startsWith(abi.SEL_AGGREGATE3)).toBe(true);
    expect(body.slice(0, 64)).toBe((0x20).toString(16).padStart(64, '0'));
    expect(body.slice(64, 128)).toBe('1'.padStart(64, '0'));
    expect(body.slice(128, 192)).toBe((0x20).toString(16).padStart(64, '0'));
    expect(body.slice(192 + 64 * 2, 192 + 64 * 3)).toBe((0x60).toString(16).padStart(64, '0'));
    expect(body.slice(192 + 64 * 3, 192 + 64 * 4)).toBe('4'.padStart(64, '0'));
    expect(body.slice(192 + 64 * 4)).toBe('12345678'.padEnd(64, '0'));
  });
  it('rejects bad input when encoding', () => {
    expect(() =>
      abi.encodeAggregate3([{ target: '0x12', allowFailure: true, data: '0x' }]),
    ).toThrow();
    expect(() => abi.encodeAggregate3([{ target: T, allowFailure: true, data: '0xzz' }])).toThrow();
  });
  it('decodes success, failure and empty return data', () => {
    const r = [
      { success: true, data: '0x' + '0'.repeat(63) + '5' },
      { success: false, data: '0x' },
    ];
    expect(abi.decodeAggregate3(enc(r), 2)).toEqual(r);
  });
  it('rejects wrong count, bad bool, bad offsets, truncation, non-hex', () => {
    const ok = enc([{ success: true, data: '0x' + '11'.repeat(32) }]);
    expect(abi.decodeAggregate3(ok, 2)).toBeNull();
    expect(abi.decodeAggregate3(ok.slice(0, -2), 1)).toBeNull();
    expect(abi.decodeAggregate3(ok.slice(0, 20), 1)).toBeNull();
    expect(abi.decodeAggregate3('0x', 1)).toBeNull();
    expect(abi.decodeAggregate3('nope', 1)).toBeNull();
    // success word = 2
    const badBool = ok.slice(0, 2 + 64 * 3) + '2'.padStart(64, '0') + ok.slice(2 + 64 * 4);
    expect(abi.decodeAggregate3(badBool, 1)).toBeNull();
    // huge element offset
    const badOff = ok.slice(0, 2 + 64 * 2) + 'f'.repeat(64) + ok.slice(2 + 64 * 3);
    expect(abi.decodeAggregate3(badOff, 1)).toBeNull();
    // huge bytes length
    const badLen = ok.slice(0, 2 + 64 * 5) + 'f'.repeat(64) + ok.slice(2 + 64 * 6);
    expect(abi.decodeAggregate3(badLen, 1)).toBeNull();
  });
});
