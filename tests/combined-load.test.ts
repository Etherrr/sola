import { describe, expect, it } from 'vitest';
import {
  combinedInputs,
  combinedMode,
  combinedProviders,
  networksWithAccounts,
  type NetworkResults,
} from '../features/portfolio/combined-load';
import { aggregateAddresses } from '../features/portfolio/aggregate';
import type { ApiSuccess, ApiWallet } from '../features/portfolio/api-client';
import type { SavedAccount } from '../features/portfolio/accounts-client';

const ETH1 = '0x' + 'a'.repeat(40);
const ETH2 = '0x' + 'b'.repeat(40);
const SOL1 = 'So1DemoAddr9' + 'z'.repeat(31);
const T1 = '2026-10-25T05:58:00.000Z';
const T2 = '2026-10-25T05:55:00.000Z';

const acct = (network: SavedAccount['network'], address: string, label: string): SavedAccount => ({
  network,
  address,
  label,
  createdAt: T2,
  updatedAt: T2,
});

const wallet = (
  address: string,
  assets: ApiWallet['assets'],
  partial = false,
  warnings: string[] = [],
): ApiWallet => ({ address, assets, partial, warnings });

const asset = (assetId: string, symbol: string, amount: string, value: string | null) => ({
  assetId,
  symbol,
  decimals: 18,
  amount,
  price: value === null ? null : '1',
  value,
});

const okData = (wallets: ApiWallet[], observedAt: string, mode: 'live' | 'mock' = 'live'): ApiSuccess => ({
  mode,
  simulated: mode === 'mock',
  provider: mode === 'live' ? 'test-live' : 'mock-fixtures',
  generatedAt: observedAt,
  observedAt,
  wallets,
  totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'test' },
  partial: wallets.some((w) => w.partial),
  warnings: [],
});

const accounts = [acct('ethereum', ETH1, 'Cold'), acct('ethereum', ETH2, 'Hot'), acct('solana', SOL1, 'Solar')];
const ethWallets = [
  wallet(ETH1, [asset('eip155:1/native', 'ETH', '1.5', '4500'), asset('eip155:1/usdc', 'USDC', '2500', '2500')]),
  wallet(ETH2, [asset('eip155:1/native', 'ETH', '0.25', '750'), asset('eip155:1/demo', 'DEMO', '1000', null)], true, ['One source was unreachable.']),
];
const solWallets = [wallet(SOL1, [asset('solana:mainnet/native', 'SOL', '20', '3000')])];
const okResults: NetworkResults = {
  ethereum: { kind: 'ok', data: okData(ethWallets, T2) },
  solana: { kind: 'ok', data: okData(solWallets, T1) },
};

describe('networksWithAccounts', () => {
  it('lists each present network once, first-seen order', () => {
    expect(networksWithAccounts(accounts)).toEqual(['ethereum', 'solana']);
    expect(networksWithAccounts([acct('solana', SOL1, 'S'), acct('ethereum', ETH1, 'E')])).toEqual(['solana', 'ethereum']);
    expect(networksWithAccounts([])).toEqual([]);
  });
});

describe('combinedInputs', () => {
  it('narrows every address to its OWN wallet so a shared response cannot double-count', () => {
    const inputs = combinedInputs(accounts, okResults);
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input.outcome.kind).toBe('ok');
      if (input.outcome.kind !== 'ok') continue;
      expect(input.outcome.data.wallets).toHaveLength(1);
      expect(input.outcome.data.wallets[0]!.address).toBe(input.address);
    }
    // End to end through the reviewed model: 4500+2500+750+3000 = 10750 USD, DEMO unpriced.
    const r = aggregateAddresses(inputs);
    const cents = r.perAddress.map((a) => a.pricedValueCents);
    expect(cents).toEqual([700000n, 75000n, 300000n]);
    expect(r.positions).toHaveLength(5);
    expect(r.perAddress[0]!.status).toBe('ok'); // a partial sibling never marks this address
    expect(r.perAddress[1]!.status).toBe('partial');
    expect(r.perAddress[1]!.warnings[0]).toBe('One source was unreachable.');
    expect(r.perAddress[1]!.unpricedAssets).toBe(1);
    expect(r.observedRange).toEqual({ earliest: T2, latest: T1 });
    expect(r.incomplete).toBe(true);
  });

  it('marks an address missing from a successful answer failed, retryable, nothing substituted', () => {
    const results: NetworkResults = { ethereum: { kind: 'ok', data: okData([ethWallets[0]!], T2) } };
    const inputs = combinedInputs([accounts[0]!, accounts[1]!], results);
    expect(inputs[0]!.outcome.kind).toBe('ok');
    const second = inputs[1]!.outcome;
    expect(second.kind).toBe('error');
    if (second.kind === 'error') {
      expect(second.message).toContain('did not include this address');
      expect(second.retryable).toBe(true);
    }
  });

  it('marks every address on a failed network failed with the real error; the other network still counts', () => {
    const results: NetworkResults = {
      ethereum: { kind: 'error', message: 'The data source is rate limiting. Try again later.', retryable: true },
      solana: okResults.solana,
    };
    const r = aggregateAddresses(combinedInputs(accounts, results));
    expect(r.perAddress[0]!.status).toBe('failed');
    expect(r.perAddress[1]!.status).toBe('failed');
    expect(r.perAddress[0]!.warnings[0]).toContain('rate limiting');
    expect(r.perAddress[2]!.status).toBe('ok');
    expect(r.observedRange).toEqual({ earliest: T1, latest: T1 });
  });

  it('marks an address failed when its network was not read at all', () => {
    const inputs = combinedInputs([accounts[2]!], {});
    expect(inputs[0]!.outcome.kind).toBe('error');
    if (inputs[0]!.outcome.kind === 'error')
      expect(inputs[0]!.outcome.message).toBe('This network was not read.');
  });

  it('matches Ethereum echoes case-insensitively but Solana echoes verbatim', () => {
    const up = '0x' + 'A'.repeat(40);
    const ethRes: NetworkResults = { ethereum: { kind: 'ok', data: okData([wallet(up, [])], T2) } };
    expect(combinedInputs([accounts[0]!], ethRes)[0]!.outcome.kind).toBe('ok');
    const solRes: NetworkResults = {
      solana: { kind: 'ok', data: okData([wallet(SOL1.toUpperCase(), [])], T1) },
    };
    expect(combinedInputs([accounts[2]!], solRes)[0]!.outcome.kind).toBe('error');
  });
});

describe('combinedMode and combinedProviders', () => {
  it('live only when every contributing answer is live', () => {
    expect(combinedMode(okResults)).toBe('live');
    expect(combinedMode({ ...okResults, solana: { kind: 'ok', data: okData(solWallets, T1, 'mock') } })).toBe('mock');
    expect(combinedMode({ ethereum: { kind: 'error', message: 'x', retryable: true }, solana: okResults.solana })).toBe('live');
    expect(combinedMode({})).toBe('none');
    expect(
      combinedMode({
        ethereum: { kind: 'error', message: 'x', retryable: true },
        solana: { kind: 'error', message: 'y', retryable: true },
      }),
    ).toBe('none');
  });
  it('lists distinct providers in first-seen order', () => {
    expect(combinedProviders(okResults)).toEqual(['test-live']);
    expect(
      combinedProviders({
        ethereum: { kind: 'ok', data: { ...okData(ethWallets, T2), provider: 'p1' } },
        solana: { kind: 'ok', data: { ...okData(solWallets, T1), provider: 'p2' } },
      }),
    ).toEqual(['p1', 'p2']);
  });
});
