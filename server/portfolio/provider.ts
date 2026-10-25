import { formatUnits, valueUsd } from './units';
import type { Asset, WalletResult } from './contract';

/** Sanitized, bounded facts about an upstream failure: numbers and fixed step names only, never raw messages, addresses or URLs. */
export type Diag = {
  step:
    | 'build'
    | 'timeout'
    | 'exception'
    | 'request'
    | 'response'
    | 'rpc_error'
    | 'decode'
    | 'block_info'
    | 'stale_node';
  http?: number;
  rpcCode?: number;
  calls?: number;
};
export type ProviderError = {
  kind: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response';
  diag?: Diag;
};
export type ProviderResult =
  | { ok: true; provider: string; simulated: boolean; observedAt: string; wallets: WalletResult[] }
  | ({ ok: false; provider: string } & ProviderError);

/** Per-request options. `aave` asks for the Aave V3 positions section (Ethereum only); providers
 *  that cannot read positions simply omit the section - it is never fabricated. */
export type FetchOptions = { aave?: boolean };

export interface PortfolioProvider {
  readonly name: string;
  readonly simulated: boolean;
  fetchWallets(addresses: string[], signal: AbortSignal, opts?: FetchOptions): Promise<ProviderResult>;
}

type Raw = { id: string; symbol: string; decimals: number; raw: bigint; price: string | null };
const OBSERVED = '2026-01-01T00:00:00.000Z';

function asset(r: Raw): Asset {
  return {
    assetId: r.id,
    symbol: r.symbol,
    decimals: r.decimals,
    rawAmount: r.raw.toString(),
    amount: formatUnits(r.raw, r.decimals),
    price: r.price,
    value: r.price === null ? null : valueUsd(r.raw, r.decimals, r.price),
    priceSource: r.price === null ? null : 'mock-fixture',
    priceObservedAt: r.price === null ? null : OBSERVED,
  };
}

const ETH = (raw: bigint, price: string | null = '2000'): Raw => ({
  id: 'eip155:1/native',
  symbol: 'ETH',
  decimals: 18,
  raw,
  price,
});
const USDC = (raw: bigint): Raw => ({
  id: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  symbol: 'USDC',
  decimals: 6,
  raw,
  price: '1',
});
const MYSTERY: Raw = {
  id: 'eip155:1/erc20:0x0000000000000000000000000000000000001234',
  symbol: 'MYST',
  decimals: 9,
  raw: 5_000_000_000n,
  price: null,
};

// Fixture scenarios are chosen by the LAST hex digit of the address so testers can try each one.
// They are labelled simulated in every response. They are not read from any blockchain.
const SCENARIOS: Record<
  string,
  { name: string; raws: Raw[]; warnings: string[]; partial?: boolean }
> = {
  '0': { name: 'empty wallet', raws: [], warnings: [] },
  '1': { name: 'native only', raws: [ETH(1_500_000_000_000_000_000n)], warnings: [] },
  '2': {
    name: 'mixed tokens',
    raws: [ETH(250_000_000_000_000_000n), USDC(1_234_560_000n)],
    warnings: [],
  },
  '3': {
    name: 'unknown price',
    raws: [ETH(10n ** 18n), MYSTERY],
    warnings: ['One asset has no price and is excluded from the subtotal.'],
  },
  '4': { name: 'very large quantity', raws: [{ ...USDC(10n ** 30n) }], warnings: [] },
  '5': {
    name: 'partial data',
    raws: [ETH(10n ** 18n)],
    warnings: [
      'Some token data could not be loaded. This result cannot tell you whether the wallet is empty.',
    ],
    partial: true,
  },
};
const DEFAULT = SCENARIOS['2']!;

// Simulated Aave V3 sections, chosen by the same last-hex-digit rule. Values are invented
// fixtures labelled simulated by the response itself; nothing is read from any chain.
type MockAave = WalletResult['aave'];
const MOCK_AAVE: Record<string, MockAave> = {
  '0': { status: 'ok', positions: [] }, // a true empty: no positions exist for this fixture
  '2': {
    status: 'ok',
    positions: [
      {
        underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        symbol: 'USDC',
        decimals: 6,
        supplied: '500.25',
        variableDebt: '0',
        suppliedValueUsd: '500.25',
        variableDebtValueUsd: '0',
        priceSource: 'mock-fixture',
        priceObservedAt: OBSERVED,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: true,
        reserveNote: null,
      },
      {
        underlyingAsset: '0x6b175474e89094c44da98b954eedeac495271d0f',
        symbol: 'DAI',
        decimals: 18,
        supplied: '0',
        variableDebt: '120.5',
        suppliedValueUsd: '0',
        variableDebtValueUsd: '120.5',
        priceSource: 'mock-fixture',
        priceObservedAt: OBSERVED,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: false,
        reserveNote: null,
      },
    ],
  },
  '3': {
    status: 'ok',
    positions: [
      {
        underlyingAsset: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
        symbol: 'UNI',
        decimals: 18,
        supplied: '42',
        variableDebt: '0',
        suppliedValueUsd: null, // no verified feed price: Unknown, never zero
        variableDebtValueUsd: '0',
        priceSource: null,
        priceObservedAt: null,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: true,
        reserveNote: null,
      },
    ],
  },
  a: { status: 'unavailable', reason: 'unavailable' },
};

export const mockProvider: PortfolioProvider = {
  name: 'mock-fixtures',
  simulated: true,
  async fetchWallets(addresses, _signal, opts) {
    const last = (a: string) => a.slice(-1).toLowerCase();
    if (addresses.some((a) => last(a) === 'f'))
      return { ok: false, provider: 'mock-fixtures', kind: 'unavailable' };
    if (addresses.some((a) => last(a) === 'e'))
      return { ok: false, provider: 'mock-fixtures', kind: 'rate_limited' };
    if (addresses.some((a) => last(a) === 'd'))
      return { ok: false, provider: 'mock-fixtures', kind: 'timeout' };
    const wallets: WalletResult[] = addresses.map((address) => {
      const sc = SCENARIOS[last(address)] ?? DEFAULT;
      const aave = opts?.aave ? MOCK_AAVE[last(address)] : undefined;
      return {
        address,
        assets: sc.raws.map(asset),
        partial: sc.partial ?? false,
        warnings: sc.warnings,
        ...(aave !== undefined ? { aave } : {}),
      };
    });
    return { ok: true, provider: 'mock-fixtures', simulated: true, observedAt: OBSERVED, wallets };
  },
};

// Simulated Solana fixture, clearly labelled: one invented SOL balance for any address. It is
// not read from any blockchain and exists only so mock deployments behave the same on both networks.
export const solanaMockProvider: PortfolioProvider = {
  name: 'mock-fixtures-solana',
  simulated: true,
  async fetchWallets(addresses) {
    const wallets: WalletResult[] = addresses.map((address) => ({
      address,
      assets: [
        asset({
          id: 'solana:mainnet/native',
          symbol: 'SOL',
          decimals: 9,
          raw: 12_345_678_901n,
          price: '200',
        }),
      ],
      partial: false,
      warnings: [],
    }));
    return {
      ok: true,
      provider: 'mock-fixtures-solana',
      simulated: true,
      observedAt: OBSERVED,
      wallets,
    };
  },
};
