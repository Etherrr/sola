import { describe, expect, it } from 'vitest';
import { keccak256 } from './helpers/keccak';
import * as abi from '../server/portfolio/abi';
import V from './fixtures-abi-vectors.json';

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

// Vectors generated once with ethers v6 (Interface.encodeFunctionData / encodeFunctionResult) from the
// Multicall3 ABI in mds1/multicall3, kept in tests/fixtures-abi-vectors.json. They are independent of
// this repo's encoder and of the test-side decoder above.
describe('canonical ABI vectors (ethers v6)', () => {
  it.each(Object.keys(V.enc))('encoder matches canonical calldata: %s', (k) => {
    const v = V.enc[k as keyof typeof V.enc];
    expect(abi.encodeAggregate3(v.calls)).toBe(v.calldata);
  });
  it.each(Object.keys(V.dec))('decoder reads canonical return data: %s', (k) => {
    const v = V.dec[k as keyof typeof V.dec];
    expect(abi.decodeAggregate3(v.returndata, v.expected)).toEqual(v.results);
  });
  it('selectors equal the library values', () => {
    expect(abi.SEL_AGGREGATE3).toBe(V.selectors.aggregate3);
    expect(abi.SEL_GET_ETH_BALANCE).toBe(V.selectors.getEthBalance);
    expect(abi.SEL_GET_BLOCK_NUMBER).toBe(V.selectors.getBlockNumber);
    expect(abi.SEL_GET_CURRENT_BLOCK_TIMESTAMP).toBe(V.selectors.getCurrentBlockTimestamp);
    expect(abi.SEL_BALANCE_OF).toBe(V.selectors.balanceOf);
    expect(abi.SEL_DECIMALS).toBe(V.selectors.decimals);
    expect(abi.SEL_LATEST_ROUND_DATA).toBe(V.selectors.latestRoundData);
  });
});
describe('hostile return data', () => {
  const good = V.dec.mixed.returndata;
  const wordAt = (h: string, byte: number, val: string) =>
    h.slice(0, 2 + byte * 2) + val.padStart(64, '0') + h.slice(2 + (byte + 32) * 2);
  it('rejects trailing bytes and truncation by one word', () => {
    expect(abi.decodeAggregate3(good + '00'.repeat(32), 5)).toBeNull();
    expect(abi.decodeAggregate3(good.slice(0, -64), 5)).toBeNull();
  });
  it('rejects two elements pointing at the same region (duplicate)', () => {
    const first = good.slice(2 + 0x40 * 2, 2 + 0x40 * 2 + 64);
    expect(abi.decodeAggregate3(wordAt(good, 0x60, first.replace(/^0+/, '') || '0'), 5)).toBeNull();
  });
  it('rejects an offset pointing back into the offsets table or into another element', () => {
    expect(abi.decodeAggregate3(wordAt(good, 0x40, '20'), 5)).toBeNull();
    expect(abi.decodeAggregate3(wordAt(good, 0x40, '1'), 5)).toBeNull();
  });
  it('rejects offsets and lengths near 2^256 and 2^53 without throwing', () => {
    for (const v of [
      'f'.repeat(64),
      '1' + '0'.repeat(63),
      (2n ** 53n).toString(16),
      (2n ** 32n).toString(16),
    ]) {
      expect(abi.decodeAggregate3(wordAt(good, 0x40, v), 5)).toBeNull();
      expect(abi.decodeAggregate3(wordAt(good, 0x20, v), 5)).toBeNull();
      expect(abi.decodeAggregate3(wordAt(good, 0x0, v), 5)).toBeNull();
    }
  });
  it('rejects an element length larger than the payload (memory-amplification attempt)', () => {
    const lenPos = 0x40 + 5 * 32 + 0x40; // first element's bytes length word
    expect(abi.decodeAggregate3(wordAt(good, lenPos, (2n ** 40n).toString(16)), 5)).toBeNull();
  });
  it('rejects a bytes offset other than 0x40', () => {
    expect(abi.decodeAggregate3(wordAt(good, 0x40 + 5 * 32 + 32, '60'), 5)).toBeNull();
  });
  it('an absurd call count or a 1 MB hex string is not decoded', () => {
    expect(abi.decodeAggregate3('0x' + '00'.repeat(1_000_000), 35)).toBeNull();
  });
});

describe('reviewer fixtures and padding', () => {
  const w = (x: number) => x.toString(16).padStart(64, '0');
  it('rejects aliased result offsets', () => {
    const x = '0x' + w(32) + w(2) + w(64) + w(64) + w(1) + w(64) + w(32) + w(8);
    expect(abi.decodeAggregate3(x, 2)).toBeNull();
  });
  it('rejects a bytes offset pointing into the tuple head', () => {
    const x = '0x' + w(32) + w(1) + w(32) + w(1) + w(0);
    expect(abi.decodeAggregate3(x, 1)).toBeNull();
  });
  it('rejects non-zero padding after bytes', () => {
    const r = V.dec.mixed.returndata;
    // element 3 holds 33 bytes (0x22...), so its second word is 1 byte of data plus 31 padding bytes
    const i = r.indexOf('22'.repeat(33)) + 66;
    expect(abi.decodeAggregate3(r.slice(0, i + 2) + '01' + r.slice(i + 4), 5)).toBeNull();
  });
});
