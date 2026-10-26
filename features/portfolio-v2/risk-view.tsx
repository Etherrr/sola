'use client';
// Plan 6.4 Risk & Return: concentration and known-debt exposure from recorded
// observations, each figure marked PARTIAL while coverage is partial. Leverage,
// collateralization, liquidation and returns stay explicitly uncalculated -
// they need protocol coverage or a cost-basis engine this build does not have.
import { fetchRisk, usePortfolioView, type ConcentrationRow } from './views-client';
import { StateBlock, Caveats } from './views-shared';
import { fmtTimestamp } from './format-time';
import { pct, shiftDecimal } from './view-format';

function ConcentrationList({ title, rows, partial }: { title: string; rows: ConcentrationRow[]; partial: boolean }) {
  return (
    <section className="panel">
      <h2>
        {title}
        {partial && <span className="tag">partial</span>}
      </h2>
      {rows.length === 0 && <p className="muted">No recorded exposure.</p>}
      {rows.length > 0 && (
        <ul className="conc-list">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="conc-label">{r.label}</span>
              <span className="conc-bar" style={{ width: `min(100%, max(0%, ${r.sharePct}%))` }} />
              <span className="conc-pct">{pct(r.sharePct)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RiskView() {
  const { status, data, retry } = usePortfolioView('risk', fetchRisk);

  if (status.kind === 'loading') return <p className="muted">Loading recorded risk view…</p>;
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
      {ok && <p className="muted">Recorded {fmtTimestamp(ok.at)}</p>}
      <Caveats
        membership={ok ? ok.recordedRunMembership : status.kind === 'empty' ? status.recordedRunMembership : null}
        newerPartial={ok ? ok.newerPartial : status.kind === 'empty' ? status.newerPartial : false}
        newerUnattributed={
          ok ? ok.newerUnattributed : status.kind === 'empty' ? status.newerUnattributed : false
        }
      />
      {status.kind === 'empty' && <StateBlock kind="empty" reason={status.reason} />}
      {ok && (
        <>
          <ConcentrationList title="By chain" rows={ok.risk.byChain} partial={ok.risk.partial} />
          <ConcentrationList title="By asset" rows={ok.risk.byAsset} partial={ok.risk.partial} />
          <ConcentrationList title="By protocol" rows={ok.risk.byProtocol} partial={ok.risk.partial} />
          <section className="panel">
            <h2>
              Debt &amp; stablecoins
              {ok.risk.partial && <span className="tag">partial</span>}
            </h2>
            <p>
              Known debt to known assets:{' '}
              <strong>
                {ok.risk.debtToKnownAssets === null
                  ? 'Not calculable - no recorded priced assets'
                  : pct(shiftDecimal(ok.risk.debtToKnownAssets, 2))}
              </strong>
            </p>
            <p>
              Stablecoin share of priced holdings:{' '}
              <strong>
                {ok.risk.stablecoinSharePct === null ? 'Not calculable' : pct(ok.risk.stablecoinSharePct)}
              </strong>
            </p>
            {ok.risk.partial && (
              <p className="muted caveat">
                Partial: known recorded positions only - unrecorded positions are not in these
                figures.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Not yet calculated</h2>
            <p className="muted">
              Leverage, collateralization and liquidation price need protocol coverage this build
              does not have.
            </p>
            <p className="muted">
              Returns and P&amp;L need a cost-basis engine - not yet calculated, never estimated.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
