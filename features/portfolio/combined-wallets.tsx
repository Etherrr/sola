// Combined-view proof: the invented per-address sample outcomes run through the REAL
// aggregateAddresses model and rendered. This section is simulated end to end; it proves
// the aggregation semantics (combined totals, per-address status, observation times), not
// live data. Honest framing is load-bearing: never present this as a real portfolio.
import { aggregateAddresses } from './aggregate';
import { combinedFixtureInputs } from './combined-fixture';
import { money, summarize } from './model';

const short = (a: string) => (a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);
const clock = (iso: string | null) =>
  iso === null ? 'n/a' : iso.slice(11, 16) + ' UTC'; // fixture times are UTC ISO strings
const hhmm = (iso: string) => iso.slice(11, 16);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

export function CombinedWallets() {
  const result = aggregateAddresses(combinedFixtureInputs);
  const totals = summarize(result.positions);
  const totalUnpriced = result.perAddress.reduce((n, a) => n + a.unpricedAssets, 0);
  const unavailable = result.perAddress.filter(
    (a) => a.status === 'failed' || a.status === 'partial',
  ).length;
  const mixedSnapshots =
    result.observedRange !== null &&
    result.observedRange.earliest !== result.observedRange.latest;
  return (
    <section className="panel combined" aria-labelledby="combined-h">
      <span className="badge">COMBINED VIEW · SIMULATED AGGREGATION</span>
      <h2 id="combined-h">Saved addresses, combined</h2>
      <p>
        Invented sample wallets run through the multi-address aggregation model: one
        combined total, per-address status, and each source's own observation time. Invented
        addresses and balances - not your wallet, not live data.
      </p>
      <div className="metric-grid">
        <div className="metric">
          <p>Combined priced sample value</p>
          <strong>{money(totals.net)}</strong>
          <small>Priced holdings across all sample addresses</small>
          {result.incomplete ? (
            <small className="warn-text">
              Incomplete: {totalUnpriced} unpriced {totalUnpriced === 1 ? 'asset' : 'assets'},{' '}
              {unavailable} {unavailable === 1 ? 'address' : 'addresses'} partial or failed -
              excluded from this figure
            </small>
          ) : null}
        </div>
        <div className="metric">
          <p>Addresses combined</p>
          <strong>{result.perAddress.filter((a) => a.pricedValueCents !== null).length}</strong>
          <small>Each address counted once; a duplicate is never a second holding</small>
        </div>
        <div className="metric">
          <p>Observation window</p>
          <strong className="obs-value">
            {result.observedRange
              ? `${dayLabel(result.observedRange.earliest)} · ${hhmm(result.observedRange.earliest)} – ${hhmm(result.observedRange.latest)} UTC`
              : 'n/a'}
          </strong>
          <small>
            Each source's own time, never the request time
            {mixedSnapshots ? ' · mixed snapshots' : ''}
          </small>
        </div>
      </div>
      <div className="combined-table-wrap" role="region" aria-label="Per-address contribution" tabIndex={0}>
      <table className="combined-table">
        <caption className="fine muted">Per-address contribution (invented samples)</caption>
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
          {result.perAddress.map((a) => (
            <tr key={`${a.network}:${a.address}`}>
              <td>
                <details className="addr">
                  <summary>
                    {a.label ?? short(a.address)}{' '}
                    <span className="fine muted">{short(a.address)}</span>
                  </summary>
                  <code className="fine">{a.address}</code>
                </details>
              </td>
              <td>{a.network === 'ethereum' ? 'Ethereum' : 'Solana'}</td>
              <td>
                {a.status === 'ok' ? (
                  <span className="badge badge-loaded">LOADED</span>
                ) : (
                  <span className="badge badge-warn">{a.status.toUpperCase()}</span>
                )}
              </td>
              <td>
                {a.pricedValueCents === null ? 'n/a' : money(a.pricedValueCents)}
                {a.unpricedAssets > 0 ? (
                  <span className="fine muted"> + {a.unpricedAssets} unknown</span>
                ) : null}
              </td>
              <td>{clock(a.observedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ul className="fine muted combined-notes">
        <li>
          Coverage: Ethereum ETH plus USDC, USDT, DAI and WETH (five assets total); Solana
          SOL balance only.
        </li>
        <li>Watched addresses are observed, not proven to be yours.</li>
        <li>
          Only values read at each source's own observation time are included; nothing is
          back-filled from older or last-known snapshots.
        </li>
        <li>Refreshes only when you ask. No alerts, no automatic updates.</li>
      </ul>
    </section>
  );
}
