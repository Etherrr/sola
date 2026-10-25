import { describe, expect, it } from 'vitest';
import { readAaveV3Positions, type RpcCall } from '../server/portfolio/aave-v3-read';
import { keccak256 } from './helpers/keccak';

const sel = (sig: string) => '0x' + keccak256(sig).slice(0, 8);
const w = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const aw = (a: string) => a.slice(2).padStart(64, '0');
const strTail = (s: string) => {
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return w(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, '0');
};
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const AUSDC = '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c';
const VDUSDC = '0x72e95b8931767c79ba4eee721354d6e99a61d004';
const ADDRESSES = {
  poolAddressesProvider: '0x2f39d218133afab8f2b819b1066c7e434ad94e9e',
  uiPoolDataProvider: '0x2dad8162a989cd99d673de4425bb2298db1e1aa2',
  user: '0x' + 'ab'.repeat(20),
};

function encReserves(): string {
  const nameTail = strTail('USD Coin');
  const symbolTail = strTail('USDC');
  const head = [
    aw(USDC), w(40 * 32), w(40 * 32 + nameTail.length / 2), w(6),
    w(5), w(6), w(7), w(8), w(1), w(1), w(1), w(0),
    w(1050n * 10n ** 24n), w(1080n * 10n ** 24n), w(15), w(16), w(1761000000n),
    aw(AUSDC), aw(VDUSDC), w(19), w(20), w(21), w(9999n * 10n ** 4n), w(23),
    w(24), w(25), w(26), w(27), w(0), w(0), w(30), w(31), w(1),
    w(33), w(34), w(35), w(36), w(1), w(38), w(39),
  ].join('');
  const arr = w(1) + w(32) + head + nameTail + symbolTail;
  return '0x' + w(0xa0) + w(10n ** 8n) + w(10n ** 8n) + w(3000n * 10n ** 8n) + w(8) + arr;
}
function encUser(a: bigint, d: bigint): string {
  return '0x' + w(0x40) + w(0) + w(1) + aw(USDC) + w(a) + w(1) + w(d);
}

const caller = (reservesHex: string | { reason: 'timeout' | 'unavailable' | 'rate_limited' | 'bad_response' }, userHex: string | { reason: 'timeout' | 'unavailable' | 'rate_limited' | 'bad_response' }): RpcCall =>
  async (_to, data) => {
    const isReserves = data.startsWith(sel('getReservesData(address)'));
    const r = isReserves ? reservesHex : userHex;
    return typeof r === 'string' ? { ok: true, result: r } : { ok: false, reason: r.reason };
  };

describe('readAaveV3Positions', () => {
  it('composes a supplied-plus-debt position with stored-index observation time and null value', async () => {
    const out = await readAaveV3Positions(
      caller(encReserves(), encUser(5n * 10n ** 6n, 2n * 10n ** 6n)),
      ADDRESSES,
    );
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.positions).toHaveLength(1);
    const p = out.positions[0]!;
    expect(p.symbol).toBe('USDC');
    expect(p.suppliedRaw).toBe(5250n * 10n ** 3n); // 5e6 scaled x 1.05 index
    expect(p.variableDebtRaw).toBe(2160n * 10n ** 3n); // 2e6 scaled x 1.08 index
    expect(p.observedAt).toBe(1761000000n);
    expect(p.valueUsd).toBeNull();
    expect(p.usageAsCollateralEnabled).toBe(true);
  });
  it('an address with no positions is a true empty, not an error', async () => {
    const out = await readAaveV3Positions(caller(encReserves(), encUser(0n, 0n)), ADDRESSES);
    expect(out).toEqual({ kind: 'ok', positions: [] });
  });
  it('any RPC failure or malformed payload is an honest unavailable state, never a zero', async () => {
    expect(await readAaveV3Positions(caller({ reason: 'rate_limited' }, encUser(1n, 0n)), ADDRESSES))
      .toEqual({ kind: 'unavailable', reason: 'rate_limited' });
    expect(await readAaveV3Positions(caller(encReserves(), { reason: 'timeout' }), ADDRESSES))
      .toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(await readAaveV3Positions(caller('0xdeadbeef', encUser(1n, 0n)), ADDRESSES))
      .toEqual({ kind: 'unavailable', reason: 'bad_payload' });
    // A user position in a reserve the data provider did not list is never guessed.
    const orphan = '0x' + w(0x40) + w(0) + w(1) + aw('0x' + 'ff'.repeat(20)) + w(1) + w(0) + w(0);
    expect(await readAaveV3Positions(caller(encReserves(), orphan), ADDRESSES))
      .toEqual({ kind: 'unavailable', reason: 'bad_payload' });
  });
});
