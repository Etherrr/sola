'use client';
// Plan 6.3 DeFi: recorded protocol positions, read-only. Lending & Borrowing
// is the only covered category today (recorded Aave V3 on Ethereum); the other
// categories are clearly labeled Coming later and never render live-looking
// data. No manufactured health factors, APY, or liquidation prices; no action
// buttons.
import { fetchPositions, usePortfolioView } from './views-client';
import { StateBlock, Caveats } from './views-shared';
import { fmtTimestamp } from './format-time';
import { amount, usd } from './view-format';

const LATER = ['Staking & Yield', 'Liquidity', 'Derivatives', 'Advanced'];
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function DefiView() {
  const { status, data, retry } = usePortfolioView('positions', fetchPositions);

  if (status.kind === 'loading') return <p className="muted">Loading recorded positions…</p>;
  if (status.kind !== 'ok' && status.kind !== 'empty')
    return (
      <div>
        <StateBlock kind={status.kind} />
        {status.kind === 'failed' && (
          <button type="button" className="btn ghost" onClick={retry}>
            Retry
          </button>
        )}
      </div>
    );

  const ok = status.kind === 'ok' ? data : null;
  return (
    <div>
      {ok && (
        <p className="muted">
          Recorded {fmtTimestamp(ok.at)} · {ok.rows.length} position
          {ok.rows.length === 1 ? '' : 's'}
        </p>
      )}
      <Caveats
        membership={ok ? ok.recordedRunMembership : status.kind === 'empty' ? status.recordedRunMembership : null}
        newerPartial={ok ? ok.newerPartial : status.kind === 'empty' ? status.newerPartial : false}
        newerUnattributed={
          ok ? ok.newerUnattributed : status.kind === 'empty' ? status.newerUnattributed : false
        }
      />
      <section className="panel">
        <h2>Lending &amp; Borrowing</h2>
        {status.kind === 'empty' && <StateBlock kind="empty" reason={status.reason} />}
        {ok && ok.rows.length === 0 && (
          <p className="muted">No recorded lending or borrowing positions.</p>
        )}
        {ok && ok.rows.length > 0 && (
          <table className="ov2-holdings-table">
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Asset</th>
                <th>Address</th>
                <th className="num">Supplied</th>
                <th className="num">Debt</th>
                <th className="num">Net</th>
                <th className="num">Supplied value</th>
                <th className="num">Debt value</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {ok.rows.map((r) => (
                <tr key={`${r.protocol}|${r.assetId}|${r.address}`}>
                  <td data-label="Protocol">
                    {r.protocol} <span className="tag">{r.network}</span>
                  </td>
                  <td data-label="Asset" title={r.assetId}>{r.symbol}</td>
                  <td data-label="Address" title={r.address}>{short(r.address)}</td>
                  <td data-label="Supplied" className="num" title={r.supplied}>
                    {amount(r.supplied)}
                  </td>
                  <td data-label="Debt" className="num" title={r.debt}>
                    {amount(r.debt)}
                  </td>
                  <td data-label="Net" className="num" title={r.net}>
                    {amount(r.net)}
                  </td>
                  <td data-label="Supplied value" className="num">
                    {usd(r.suppliedValueUsd)}
                    {r.priceStale && r.suppliedValueUsd !== null && <span className="tag">stale</span>}
                  </td>
                  <td data-label="Debt value" className="num">{usd(r.debtValueUsd)}</td>
                  <td data-label="Observed" title={r.observedAt}>{fmtTimestamp(r.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted caveat">
          Health factor, APY and liquidation price are not calculated - they need protocol
          coverage this build does not have.
        </p>
      </section>
      {LATER.map((c) => (
        <section className="panel" key={c}>
          <h2>{c}</h2>
          <p className="muted">Coming later.</p>
        </section>
      ))}
    </div>
  );
}
