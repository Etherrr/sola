import { describe, expect, it } from 'vitest';
import { createLiveProvider, TOKENS } from '../server/portfolio/live-provider';
import { keccak256 } from './helpers/keccak';

// Aave V3 integration at the live-provider seam: synthetic UiPoolDataProvider payloads served by
// a fake JSON-RPC endpoint; pricing must come only from the app's own Chainlink feeds.
const NOW = new Date('2026-10-24T03:00:00.000Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const ADDR = '0x' + 'ab'.repeat(20);
const UI = '0x2dad8162a989cd99d673de4425bb2298db1e1aa2';
const MC = '0xca11bde05977b3631167028862be2a173976ca11';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';

const sel = (sig: string) => '0x' + keccak256(sig).slice(0, 8);
const SEL_RESERVES = sel('getReservesData(address)');
const SEL_USER = sel('getUserReservesData(address,address)');
const w = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const aw = (a: string) => a.slice(2).padStart(64, '0');
const hex = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const round = (answer: bigint, updated: number) =>
  '0x' +
  [7n, answer, BigInt(updated - 10), BigInt(updated), 7n]
    .map((x) => x.toString(16).padStart(64, '0'))
    .join('');
const strTail = (s: string) => {
  const hexS = Buffer.from(s, 'utf8').toString('hex');
  return w(hexS.length / 2) + hexS.padEnd(Math.ceil(hexS.length / 64) * 64 || 0, '0');
};

type Reserve = {
  underlying: string;
  symbol: string;
  decimals: number;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  lastUpdate: bigint;
  active?: boolean;
  frozen?: boolean;
  paused?: boolean;
};
function encReserves(rs: Reserve[]): string {
  let off = rs.length * 32; // offsets are relative to the offset-table start
  const heads: string[] = [];
  const offsets: string[] = [];
  for (const r of rs) {
    offsets.push(w(off));
    const nameTail = strTail(r.symbol + ' token');
    const symbolTail = strTail(r.symbol);
    const head = [
      aw(r.underlying), w(40 * 32), w(40 * 32 + nameTail.length / 2), w(r.decimals),
      w(5), w(6), w(7), w(8), w(1), w(1), w(r.active === false ? 0 : 1), w(r.frozen ? 1 : 0),
      w(r.liquidityIndex), w(r.variableBorrowIndex), w(15), w(16), w(r.lastUpdate),
      aw('0x' + 'aa'.repeat(20)), aw('0x' + 'bb'.repeat(20)), w(19), w(20), w(21),
      w(9999n * 10n ** 4n), w(23), w(24), w(25), w(26), w(27), w(r.paused ? 1 : 0), w(0), w(30), w(31), w(1),
      w(33), w(34), w(35), w(36), w(1), w(38), w(39),
    ].join('');
    heads.push(head + nameTail + symbolTail);
    off += (head.length + nameTail.length + symbolTail.length) / 2;
  }
  const arr = w(rs.length) + offsets.join('') + heads.join('');
  return '0x' + w(0xa0) + w(10n ** 8n) + w(10n ** 8n) + w(3000n * 10n ** 8n) + w(8) + arr;
}
const encUser = (rows: { underlying: string; a: bigint; c?: boolean; d: bigint }[]) =>
  '0x' +
  w(0x40) +
  w(0) +
  w(rows.length) +
  rows.map((r) => aw(r.underlying) + w(r.a) + w(r.c === false ? 0 : 1) + w(r.d)).join('');

const IDX = {
  usdc: { liq: 1050n * 10n ** 24n, bor: 1080n * 10n ** 24n }, // 1.05 / 1.08 ray
  dai: { liq: 1020n * 10n ** 24n, bor: 1040n * 10n ** 24n }, // 1.02 / 1.04 ray
};
const RESERVES = encReserves([
  {
    underlying: USDC, symbol: 'USDC', decimals: 6,
    liquidityIndex: IDX.usdc.liq, variableBorrowIndex: IDX.usdc.bor, lastUpdate: 1761000000n,
  },
  {
    underlying: DAI, symbol: 'DAI', decimals: 18,
    liquidityIndex: IDX.dai.liq, variableBorrowIndex: IDX.dai.bor, lastUpdate: 1761000060n,
    frozen: true,
  },
]);

/** Test-side aggregate3 decoder, independent of the production encoder (mirrors live-provider.test.ts). */
function decodeCalls(data: string): { target: string; data: string }[] {
  const b = data.slice(10);
  const word = (o: number) => BigInt('0x' + b.slice(o * 2, o * 2 + 64));
  const n = Number(word(0x20));
  const out: { target: string; data: string }[] = [];
  for (let i = 0; i < n; i++) {
    const el = 0x40 + Number(word(0x40 + i * 32));
    const target = '0x' + b.slice((el + 12) * 2, (el + 32) * 2);
    const len = Number(word(el + 0x60));
    out.push({ target, data: '0x' + b.slice((el + 0x80) * 2, (el + 0x80 + len) * 2) });
  }
  return out;
}
function encodeResults(rs: { success: boolean; data: string }[]): string {
  const ww = (x: number) => x.toString(16).padStart(64, '0');
  const els = rs.map((r) => {
    const body = r.data.slice(2);
    return (
      ww(r.success ? 1 : 0) + ww(0x40) + ww(body.length / 2) +
      body.padEnd(Math.ceil(body.length / 64) * 64, '0')
    );
  });
  let off = rs.length * 32;
  const offs = els.map((e) => {
    const o = off;
    off += e.length / 2;
    return ww(o);
  });
  return '0x' + ww(0x20) + ww(rs.length) + offs.join('') + els.join('');
}

type AaveBehavior =
  | { kind: 'ok'; userHex: string }
  | { kind: 'http'; status: number }
  | { kind: 'rpc_error'; code: number }
  | { kind: 'raw'; hex: string }
  | { kind: 'throw' };

function fakeRpc(aave: AaveBehavior, feedAnswers: Partial<Record<string, bigint>> = {}) {
  const seen = { multicall: 0, aaveReserves: 0, aaveUser: 0 };
  const f = (async (_u: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as {
      id: number;
      method: string;
      params: [{ to: string; data: string }, string];
    };
    const to = req.params[0].to.toLowerCase();
    if (to === UI) {
      const isReserves = req.params[0].data.startsWith(SEL_RESERVES);
      if (isReserves) seen.aaveReserves += 1;
      else seen.aaveUser += 1;
      if (aave.kind === 'throw') throw new Error('network down');
      if (aave.kind === 'http')
        return new Response('busy', { status: aave.status });
      if (aave.kind === 'rpc_error')
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: aave.code, message: 'x' } }),
          { status: 200 },
        );
      const hexBody = aave.kind === 'raw' ? aave.hex : isReserves ? RESERVES : aave.userHex;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: hexBody }), {
        status: 200,
      });
    }
    // Multicall3 aggregate3: block info + one ETH balance + feed rounds (token balances zero).
    const results = decodeCalls(req.params[0].data).map((c) => {
      const ok = (data: string) => ({ success: true, data });
      if (c.target === MC) {
        if (c.data === '0x42cbb15c') return ok(hex(20_000_000n));
        if (c.data === '0x0f28c97d') return ok(hex(BigInt(nowS)));
        return ok(hex(10n ** 18n)); // 1 ETH
      }
      const feed = (Object.keys(feedAnswers) as string[]).find(() => false);
      void feed;
      if (c.data === '0x313ce567') return ok(hex(8n));
      const answers: Record<string, bigint> = {
        '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419': 2000n * 10n ** 8n,
        '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6': 100_000_000n,
        '0x3e7d1eab13ad0104d2750b8863b489d65364e32d': 100_000_000n,
        '0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9': 100_000_000n,
        ...feedAnswers,
      };
      return ok(round(answers[c.target] ?? 100_000_000n, nowS - 60));
    });
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: req.id, result: encodeResults(results) }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { f, seen };
}

const run = (
  f: typeof fetch,
  opts?: { aave?: boolean },
  addresses = [ADDR],
  signal = new AbortController().signal,
) => createLiveProvider({ fetch: f, now: () => NOW }).fetchWallets(addresses, signal, opts);

describe('Aave V3 section in the live Ethereum provider', () => {
  it('is absent unless requested, and no Aave call is made', async () => {
    const { f, seen } = fakeRpc({ kind: 'ok', userHex: encUser([]) });
    const r = await run(f);
    if (!r.ok) throw new Error('lookup failed');
    expect(r.wallets[0]!.aave).toBeUndefined();
    expect(seen.aaveReserves + seen.aaveUser).toBe(0);
  });

  it('composes priced supplied and variable-debt positions from verified feeds only', async () => {
    // 5,000,000 scaled aUSDC at 1.05 index -> 5.25 USDC supplied; 2,000 scaled DAI debt at 1.04 -> 2080 DAI.
    const userHex = encUser([
      { underlying: USDC, a: 5_000_000n, d: 0n },
      { underlying: DAI, a: 0n, c: false, d: 2_000n * 10n ** 18n },
    ]);
    const { f, seen } = fakeRpc({ kind: 'ok', userHex });
    const r = await run(f, { aave: true });
    if (!r.ok) throw new Error('lookup failed');
    expect(seen.aaveReserves).toBe(1); // one reserves read serves the whole request
    expect(seen.aaveUser).toBe(1);
    const aave = r.wallets[0]!.aave;
    expect(aave?.status).toBe('ok');
    if (aave?.status !== 'ok') return;
    expect(aave.positions).toHaveLength(2);
    const usdc = aave.positions.find((p) => p.symbol === 'USDC')!;
    expect(usdc.supplied).toBe('5.25');
    expect(usdc.variableDebt).toBe('0');
    expect(usdc.suppliedValueUsd).toBe('5.25'); // Chainlink USDC/USD 1.00
    expect(usdc.variableDebtValueUsd).toBe('0');
    expect(usdc.priceSource).toBe('chainlink:USDC/USD');
    expect(usdc.observedAt).toBe(new Date(1761000000 * 1000).toISOString());
    expect(usdc.usageAsCollateralEnabled).toBe(true);
    expect(usdc.reserveNote).toBeNull();
    const dai = aave.positions.find((p) => p.symbol === 'DAI')!;
    expect(dai.supplied).toBe('0');
    expect(dai.variableDebt).toBe('2080');
    expect(dai.variableDebtValueUsd).toBe('2080');
    expect(dai.suppliedValueUsd).toBe('0');
    expect(dai.reserveNote).toBe('This reserve is frozen on Aave.');
    expect(dai.usageAsCollateralEnabled).toBe(false);
  });

  it('an unpriced underlying keeps its value Unknown, never zero and never Aave-priced', async () => {
    const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
    const reserves = encReserves([
      {
        underlying: UNI, symbol: 'UNI', decimals: 18,
        liquidityIndex: 10n ** 27n, variableBorrowIndex: 10n ** 27n, lastUpdate: 1761000000n,
      },
    ]);
    const { f } = fakeRpc({ kind: 'ok', userHex: encUser([{ underlying: UNI, a: 42n * 10n ** 18n, d: 0n }]) });
    // Override the reserves answer: patch fakeRpc's RESERVES via raw behavior per-call.
    const inner = f;
    const g = (async (u: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      if (
        req.params[0].to.toLowerCase() === UI &&
        req.params[0].data.startsWith(SEL_RESERVES)
      )
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: reserves }), {
          status: 200,
        });
      return inner(u, init);
    }) as unknown as typeof fetch;
    const r = await run(g, { aave: true });
    if (!r.ok) throw new Error('lookup failed');
    const aave = r.wallets[0]!.aave;
    if (aave?.status !== 'ok') throw new Error('aave read failed');
    const uni = aave.positions[0]!;
    expect(uni.symbol).toBe('UNI');
    expect(uni.supplied).toBe('42');
    expect(uni.suppliedValueUsd).toBeNull();
    expect(uni.priceSource).toBeNull();
    expect(uni.priceObservedAt).toBeNull();
  });

  it('an Aave-side failure degrades only the section; wallet balances still return', async () => {
    for (const behavior of [
      { kind: 'http', status: 429 },
      { kind: 'http', status: 500 },
      { kind: 'rpc_error', code: -32005 },
      { kind: 'raw', hex: '0xdeadbeef' },
      { kind: 'throw' },
    ] as AaveBehavior[]) {
      const { f } = fakeRpc(behavior);
      const r = await run(f, { aave: true });
      if (!r.ok) throw new Error('wallet lookup must survive an Aave failure');
      const w0 = r.wallets[0]!;
      expect(w0.assets.some((a) => a.symbol === 'ETH')).toBe(true);
      expect(w0.aave?.status).toBe('unavailable');
      if (w0.aave?.status !== 'unavailable') return;
      if (behavior.kind === 'http' && behavior.status === 429)
        expect(w0.aave.reason).toBe('rate_limited');
      else if (behavior.kind === 'rpc_error') expect(w0.aave.reason).toBe('rate_limited');
      else if (behavior.kind === 'raw') expect(w0.aave.reason).toBe('bad_response');
      else expect(w0.aave.reason).toBe('unavailable');
    }
  });

  it('a true empty is an ok section with zero positions', async () => {
    const { f } = fakeRpc({ kind: 'ok', userHex: encUser([{ underlying: USDC, a: 0n, d: 0n }]) });
    const r = await run(f, { aave: true });
    if (!r.ok) throw new Error('lookup failed');
    expect(r.wallets[0]!.aave).toEqual({ status: 'ok', positions: [] });
  });

  it('multiple addresses share one reserves read; a failing user read degrades only that wallet', async () => {
    const ADDR2 = '0x' + 'cd'.repeat(20);
    let userCalls = 0;
    const { f } = fakeRpc({
      kind: 'ok',
      userHex: encUser([{ underlying: USDC, a: 5_000_000n, d: 0n }]),
    });
    const g = (async (u: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      if (
        req.params[0].to.toLowerCase() === UI &&
        req.params[0].data.startsWith(SEL_USER)
      ) {
        userCalls += 1;
        if (userCalls === 2) return new Response('x', { status: 500 }); // second user fails
      }
      return f(u, init);
    }) as unknown as typeof fetch;
    const r = await run(g, { aave: true }, [ADDR, ADDR2]);
    if (!r.ok) throw new Error('lookup failed');
    expect(r.wallets[0]!.aave?.status).toBe('ok');
    expect(r.wallets[1]!.aave).toEqual({ status: 'unavailable', reason: 'unavailable' });
  });
});

describe('TOKENS cover the priced Aave underlyings', () => {
  it('every app-priced token address is lowercase for the underlying match', () => {
    for (const t of TOKENS) expect(t.address).toBe(t.address.toLowerCase());
  });
});
