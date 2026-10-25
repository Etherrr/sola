'use client';
import { money, summarize } from '../portfolio/model';
import { fmtTimestamp } from './format-time';
import { useCombined } from './combined-context';

/**
 * v0.2 "All saved addresses" - the combined multi-address read the plan keeps
 * from /track. Explicit user action only: nothing loads automatically. State
 * lives in CombinedProvider so the Allocation panel derives from the SAME
 * single request set. Reuses the reviewed pure pipeline (per-network resolve
 * -> per-address narrowing -> aggregateAddresses): a duplicate is never a
 * second holding, an unpriced asset is unknown never zero, a failed address is
 * named, and every source keeps its own observation time. Watched addresses
 * are observed, not proven to be yours.
 */

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function CombinedBalances() {
  const { phase, load } = useCombined();

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
  const loadedCount = ready
    ? ready.result.perAddress.filter((a) => a.status === 'ok' || a.status === 'partial').length
    : 0;
  const partialCount = ready
    ? ready.result.perAddress.filter((a) => a.status === 'partial').length
    : 0;
  const hasSolana = ready
    ? ready.result.perAddress.some((a) => a.network === 'solana')
    : false;

  return (
    <div className="combined ov2-combined" aria-busy={phase.kind === 'loading'}>
      <h3 className="ov2-h3">All saved addresses</h3>
      {phase.kind === 'idle' ? (
        <>
          <p className="ov2-quiet">
            On your request only. Loading sends your saved addresses to third-party blockchain
            data providers; your balances are not saved by this action.
          </p>
          {phase.notice ? <p className="ov2-quiet">{phase.notice}</p> : null}
          <button type="button" className="button primary" onClick={load}>
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
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </>
      ) : null}
      {phase.kind === 'empty' ? (
        <>
          <p className="ov2-quiet">No saved addresses yet. Add one above, then load.</p>
          <button type="button" className="button primary" onClick={load}>
            Load combined balances
          </button>
        </>
      ) : null}
      {ready && totals ? (
        <div data-sensitive>
          <div className="metric-grid">
            <div className="metric">
              <p>Combined priced value{ready.mode === 'mock' ? ' · Demo' : ''}</p>
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
              <p>Addresses loaded</p>
              <strong>
                {loadedCount} of {ready.totalSaved}
              </strong>
              <small>
                {contributing} with a priced value
                {partialCount > 0
                  ? ` · ${partialCount} partial (some sources did not answer)`
                  : ''}
              </small>
            </div>
            <div className="metric">
              <p>Snapshot taken</p>
              <strong className="obs-value">
                {ready.result.observedRange
                  ? ready.result.observedRange.earliest === ready.result.observedRange.latest
                    ? fmtTimestamp(ready.result.observedRange.earliest)
                    : `${fmtTimestamp(ready.result.observedRange.earliest)} – ${fmtTimestamp(
                        ready.result.observedRange.latest,
                      )}`
                  : 'n/a'}
              </strong>
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
            never zero. Each address counted once.
            {hasSolana ? ' Solana lookups show the SOL balance only.' : ''}
            {ready.providers.length > 0 ? ` Sources: ${ready.providers.join(', ')}.` : ''}{' '}
            {ready.result.priceAsOf ? `Prices updated ${fmtTimestamp(ready.result.priceAsOf)}.` : ''}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={phase.kind === 'loading'}
            onClick={load}
          >
            Refresh now
          </button>
        </div>
      ) : null}
    </div>
  );
}
