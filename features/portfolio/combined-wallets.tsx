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

export function CombinedWallets() {
  const result = aggregateAddresses(combinedFixtureInputs);
  const totals = summarize(result.positions);
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
        </div>
        <div className="metric">
          <p>Addresses combined</p>
          <strong>{result.perAddress.filter((a) => a.pricedValueCents !== null).length}</strong>
          <small>
            {result.incomplete
              ? `Incomplete: ${totals.unpriced} unpriced, partial or failed sources listed below`
              : 'All sources complete'}
          </small>
        </div>
        <div className="metric">
          <p>Observation window</p>
          <strong>
            {result.observedRange
              ? `${hhmm(result.observedRange.earliest)} – ${hhmm(result.observedRange.latest)} UTC`
              : 'n/a'}
          </strong>
          <small>Each source's own time, never the request time</small>
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
                {a.label ?? short(a.address)} <span className="fine muted">{short(a.address)}</span>
              </td>
              <td>{a.network === 'ethereum' ? 'Ethereum' : 'Solana'}</td>
              <td>
                <span className={`badge ${a.status === 'ok' ? 'badge-ok' : 'badge-warn'}`}>
                  {a.status.toUpperCase()}
                </span>
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
    </section>
  );
}
