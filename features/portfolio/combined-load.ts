// Maps saved accounts plus per-network resolve outcomes into AggregateInput rows for the
// reviewed aggregateAddresses model. PURE: no fetch, no state, no clock.
//
// Honesty rules (load-bearing):
// - One resolve call per network returns every requested wallet; each address is narrowed
//   to its OWN wallet before aggregation, so a shared response is never double-counted.
// - An address missing from a successful answer is a failed read for that address only;
//   nothing is substituted for it.
// - A failed network call marks every saved address on that network failed with the real
//   error; the other network's data still counts.
import type { AggregateInput } from './aggregate';
import type { ApiSuccess, TrackNetwork } from './api-client';
import type { SavedAccount } from './accounts-client';

export type NetworkResolve =
  | { kind: 'ok'; data: ApiSuccess }
  | { kind: 'error'; message: string; retryable: boolean };

export type NetworkResults = Partial<Record<TrackNetwork, NetworkResolve>>;

/** Networks that have at least one saved address, in first-seen order. */
export function networksWithAccounts(accounts: readonly SavedAccount[]): TrackNetwork[] {
  const out: TrackNetwork[] = [];
  for (const a of accounts) if (!out.includes(a.network)) out.push(a.network);
  return out;
}

/** Address identity is chain-specific: EVM hex is case-insensitive, Solana base58 is verbatim. */
const sameAddress = (network: TrackNetwork, a: string, b: string) =>
  network === 'ethereum' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function combinedInputs(
  accounts: readonly SavedAccount[],
  results: NetworkResults,
): AggregateInput[] {
  return accounts.map((a) => {
    const base = { network: a.network, address: a.address, label: a.label };
    const r = results[a.network];
    if (!r)
      return {
        ...base,
        outcome: { kind: 'error', message: 'This network was not read.', retryable: true },
      };
    if (r.kind !== 'ok')
      return { ...base, outcome: { kind: 'error', message: r.message, retryable: r.retryable } };
    const wallet = r.data.wallets.find((w) => sameAddress(a.network, w.address, a.address));
    if (!wallet)
      return {
        ...base,
        outcome: {
          kind: 'error',
          message: 'The answer did not include this address. Nothing was substituted.',
          retryable: true,
        },
      };
    // Per-address truth: the shared response's status fields describe ALL its wallets; narrow
    // them to this address's own wallet so one partial sibling never marks another address.
    return {
      ...base,
      outcome: {
        kind: 'ok',
        data: { ...r.data, wallets: [wallet], partial: wallet.partial, warnings: wallet.warnings },
      },
    };
  });
}

/** Display mode of a loaded combined view: live only when every contributing answer is live;
 *  'none' when NO answer contributed (every network failed) - never claim a data mode then. */
export function combinedMode(results: NetworkResults): 'live' | 'mock' | 'none' {
  let any = false;
  for (const k of ['ethereum', 'solana'] as const) {
    const r = results[k];
    if (r && r.kind === 'ok') {
      any = true;
      if (r.data.mode !== 'live' || r.data.simulated) return 'mock';
    }
  }
  return any ? 'live' : 'none';
}

/** Distinct provider names across contributing answers, first-seen order. */
export function combinedProviders(results: NetworkResults): string[] {
  const out: string[] = [];
  for (const k of ['ethereum', 'solana'] as const) {
    const r = results[k];
    if (r && r.kind === 'ok' && !out.includes(r.data.provider)) out.push(r.data.provider);
  }
  return out;
}
