// Invented sample lookup outcomes for the combined-view proof. Not real addresses,
// balances, or price observations. Shaped exactly like resolve outcomes so the rendered
// section exercises the REAL aggregateAddresses model end to end.
import type { AggregateInput } from './aggregate';

const T1 = '2026-10-24T13:58:00.000Z';
const T2 = '2026-10-24T13:55:00.000Z';

export const combinedFixtureInputs: AggregateInput[] = [
  {
    network: 'ethereum',
    address: '0x' + 'a'.repeat(40),
    label: 'Cold wallet',
    outcome: {
      kind: 'ok',
      data: {
        mode: 'mock', simulated: true, provider: 'fixture', generatedAt: T1, observedAt: T1,
        wallets: [{
          address: '0x' + 'a'.repeat(40), partial: false, warnings: [],
          assets: [
            { assetId: 'sim:ethereum:eth', symbol: 'ETH', decimals: 18, amount: '1.5', price: '3000', value: '4500' },
            { assetId: 'sim:ethereum:usdc', symbol: 'USDC', decimals: 6, amount: '2500', price: '1', value: '2500' },
          ],
        }],
        totals: { recognizedPricedSubtotalUsd: '7000', unpricedAssetCount: 0, note: 'fixture' },
        partial: false, warnings: [],
      },
    },
  },
  {
    network: 'ethereum',
    address: '0x' + 'b'.repeat(40),
    label: 'Hot wallet',
    outcome: {
      kind: 'ok',
      data: {
        mode: 'mock', simulated: true, provider: 'fixture', generatedAt: T2, observedAt: T2,
        wallets: [{
          address: '0x' + 'b'.repeat(40), partial: true, warnings: ['One source was unreachable.'],
          assets: [
            { assetId: 'sim:ethereum:eth', symbol: 'ETH', decimals: 18, amount: '0.25', price: '3000', value: '750' },
            { assetId: 'sim:ethereum:demo', symbol: 'DEMO', decimals: 18, amount: '1000', price: null, value: null },
          ],
        }],
        totals: { recognizedPricedSubtotalUsd: '750', unpricedAssetCount: 1, note: 'fixture' },
        partial: true, warnings: ['Partial data.'],
      },
    },
  },
  {
    network: 'solana',
    address: 'So1DemoAddr9' + 'z'.repeat(31),
    label: 'Solar',
    outcome: {
      kind: 'ok',
      data: {
        mode: 'mock', simulated: true, provider: 'fixture', generatedAt: T1, observedAt: T1,
        wallets: [{
          address: 'So1DemoAddr9' + 'z'.repeat(31), partial: false, warnings: [],
          assets: [
            { assetId: 'sim:solana:sol', symbol: 'SOL', decimals: 9, amount: '20', price: '150', value: '3000' },
          ],
        }],
        totals: { recognizedPricedSubtotalUsd: '3000', unpricedAssetCount: 0, note: 'fixture' },
        partial: false, warnings: [],
      },
    },
  },
];
