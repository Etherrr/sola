'use client';
import { useRef, useState } from 'react';
import { lookupAddresses, addressBookRequest } from '../portfolio/api-client';
import { aggregateAddresses } from '../portfolio/aggregate';
import {
  combinedInputs,
  combinedMode,
  combinedProviders,
  networksWithAccounts,
  type NetworkResults,
} from '../portfolio/combined-load';
import { money, summarize } from '../portfolio/model';
import type { SavedAccount } from '../portfolio/accounts-client';
import { fmtTimestamp } from './format-time';

/**
 * v0.2 "All saved addresses" - the combined multi-address read the plan keeps
 * from /track. Explicit user action only: nothing loads automatically. Reuses
 * the reviewed pure pipeline (per-network resolve -> per-address narrowing ->
 * aggregateAddresses): a duplicate is never a second holding, an unpriced
 * asset is unknown never zero, a failed address is named, and every source
 * keeps its own observation time. Watched addresses are observed, not proven
 * to be yours.
 */

type Entry = {
  network: 'ethereum' | 'solana';
  address: string;
  label: string;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'ready';
      result: ReturnType<typeof aggregateAddresses>;
      mode: 'live' | 'mock' | 'none';
      providers: string[];
      totalSaved: number;
      loadedAt: string;
    };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function CombinedBalances() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const generation = useRef(0);

  async function onLoad() {
    if (phase.kind === 'loading') return;
    const g = ++generation.current;
    setPhase({ kind: 'loading' });
    let res: Response;
    try {
      res = await addressBookRequest('GET', undefined);
    } catch {
      if (generation.current === g)
        setPhase({ kind: 'failed', message: 'Saved addresses could not be read. Nothing was substituted.' });
      return;
    }
    if (generation.current !== g) return;
    if (res.status === 401) {
      setPhase({ kind: 'failed', message: 'Sign in to load your saved addresses.' });
      return;
    }
    if (res.status === 503) {
      setPhase({ kind: 'failed', message: 'Saved addresses are switched off on this build. Nothing was read.' });
      return;
    }
    if (!res.ok) {
      setPhase({ kind: 'failed', message: 'Saved addresses could not be read. Nothing was substituted.' });
      return;
    }
    const body = (await res.json()) as { status?: string; addresses?: Entry[] };
    if (body.status !== 'ok' || !Array.isArray(body.addresses)) {
      setPhase({ kind: 'failed', message: 'Saved addresses could not be read. Nothing was substituted.' });
      return;
    }
    if (body.addresses.length === 0) {
      setPhase({ kind: 'empty' });
      return;
    }
    const accounts: SavedAccount[] = body.addresses.map((a) => ({
      network: a.network,
      address: a.address,
      label: a.label,
      createdAt: '',
      updatedAt: '',
    }));
    const networks = networksWithAccounts(accounts);
    const results: NetworkResults = {};
    await Promise.all(
      networks.map(async (n) => {
        results[n] = await lookupAddresses(
          n,
          accounts.filter((a) => a.network === n).map((a) => a.address),
        );
      }),
    );
    if (generation.current !== g) return;
    setPhase({
      kind: 'ready',
      result: aggregateAddresses(combinedInputs(accounts, results)),
      mode: combinedMode(results),
      providers: combinedProviders(results),
      totalSaved: accounts.length,
      loadedAt: new Date().toISOString(),
    });
  }

  const ready = phase.kind === 'ready' ? phase : null;
  const totals = ready ? summarize(ready.result.positions) : null;
  const totalUnpriced = ready
    ? ready.result.perAddress.reduce((n, a) => n + a.unpricedAssets, 0)
    : 0;
  const unavailable = ready
    ? ready.result.perAddress.filter((a) => a.status === 'failed' || a.status === 'partial').length
    : 0;
  const contributing = ready
    ? ready.result.perAddress.filter((a) => a.pricedValueCents !== null).length
    : 0;

  return (
    <div className="combined ov2-combined" aria-busy={phase.kind === 'loading'}>
      <h3 className="ov2-h3">All saved addresses</h3>
      {phase.kind === 'idle' ? (
        <>
          <p className="ov2-quiet">
            Reads every saved address through the read-only API and combines them. On your
            request only - nothing loads automatically.
          </p>
          <button type="button" className="button primary" onClick={() => void onLoad()}>
            Load combined balances
          </button>
        </>
      ) : null}
      {phase.kind === 'loading' ? (
        <p className="ov2-quiet" role="status">Reading saved addresses and balances…</p>
      ) : null}
      {phase.kind === 'failed' ? (
        <>
          <p><em>{phase.message}</em></p>
          <button type="button" className="button secondary" onClick={() => void onLoad()}>
            Try again
          </button>
        </>
      ) : null}
      {phase.kind === 'empty' ? (
        <p className="ov2-quiet">No saved addresses yet. Add one above, then load.</p>
      ) : null}
      {ready && totals ? (
        <div data-sensitive>
          <div className="metric-grid">
            <div className="metric">
              <p>Combined priced value{ready.mode === 'mock' ? ' (simulated)' : ''}</p>
              {/* n/a, never $0.00, when no address contributed: zero would read as empty wallets. */}
              <strong>{contributing === 0 ? 'n/a' : money(totals.net)}</strong>
              {ready.result.incomplete ? (
                <small className="warn-text">
                  Incomplete: {totalUnpriced} unpriced {totalUnpriced === 1 ? 'asset' : 'assets'},{' '}
                  {unavailable} {unavailable === 1 ? 'address' : 'addresses'} partial or failed.
                </small>
              ) : null}
            </div>
            <div className="metric">
              <p>Addresses combined</p>
              <strong>
                {contributing} of {ready.totalSaved}
              </strong>
            </div>
            <div className="metric">
              <p>Observation window</p>
              <strong className="obs-value">
                {ready.result.observedRange
                  ? `${fmtTimestamp(ready.result.observedRange.earliest)} – ${fmtTimestamp(
                      ready.result.observedRange.latest,
                    )}`
                  : 'n/a'}
              </strong>
              <small>Each source&apos;s own time, never the request time</small>
            </div>
          </div>
          <table className="combined-table ov2-holdings-table">
            <caption className="ov2-quiet">Per-address contribution (saved addresses)</caption>
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Network</th>
                <th scope="col">Status</th>
                <th scope="col">Priced value</th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody>
              {ready.result.perAddress.map((a) => (
                <tr key={`${a.network}:${a.address}`}>
                  <td data-label="Address" title={a.address}>
                    {a.label ?? short(a.address)}{' '}
                    <small className="ov2-quiet">{short(a.address)}</small>
                  </td>
                  <td data-label="Network">{a.network === 'ethereum' ? 'EVM' : 'Solana'}</td>
                  <td data-label="Status">
                    {a.status === 'ok' ? (
                      'Loaded'
                    ) : (
                      <span className="badge badge-warn">{a.status.toUpperCase()}</span>
                    )}
                  </td>
                  <td data-label="Priced value">
                    {a.pricedValueCents === null ? 'n/a' : money(a.pricedValueCents)}
                    {a.unpricedAssets > 0 ? (
                      <small className="ov2-quiet"> + {a.unpricedAssets} unknown</small>
                    ) : null}
                  </td>
                  <td data-label="Observed">
                    {a.observedAt === null ? 'n/a' : fmtTimestamp(a.observedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ready.result.perAddress.some((a) => a.status !== 'ok' && a.warnings.length > 0) ? (
            <ul className="ov2-quiet combined-notes">
              {ready.result.perAddress
                .filter((a) => a.status !== 'ok')
                .map((a) => (
                  <li key={`w-${a.network}:${a.address}`}>
                    {a.label ?? short(a.address)}: {a.warnings[0]}
                  </li>
                ))}
            </ul>
          ) : null}
          <p className="ov2-quiet">
            Priced values cover only assets with verified-feed prices; anything else is unknown,
            never zero. Each address counted once; a duplicate is never a second holding.
            {ready.providers.length > 0 ? ` Sources: ${ready.providers.join(', ')}.` : ''}{' '}
            Loaded at your request at {fmtTimestamp(ready.loadedAt)} - the request time, not an
            observation time.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={phase.kind === 'loading'}
            onClick={() => void onLoad()}
          >
            Refresh now
          </button>
        </div>
      ) : null}
    </div>
  );
}
