'use client';
// Plan 6.1 Overview on the recorded wire (reviewer binding verdict A1-A5 +
// PIN1-3, 2026-10-26). Headline is the RECOGNIZED PRICED value only - debt is
// always separate, net renders solely under its own explicit label, and the
// history chart plots ACTUAL recorded runs per network: no combined
// carry-forward line, no invented coverage, no returns/performance framing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOverviewView, type OverviewResult, type HistorySeries } from './views-client';
import { StateBlock, Caveats } from './views-shared';
import { usd } from './view-format';
import { feedTimeUTC as fmtTime } from './format-time';

type Load = { kind: 'loading' } | OverviewResult;

const RANGES = [
  { key: '1D', ms: 24 * 60 * 60_000 },
  { key: '7D', ms: 7 * 24 * 60 * 60_000 },
  { key: '30D', ms: 30 * 24 * 60 * 60_000 },
] as const;

const latestMs = (series: HistorySeries[]) =>
  Math.max(...series.flatMap((s) => s.points.map((p) => Date.parse(p.observedAt))));

/** Offer a range only where the recorded span supports it (A1/plan 6.1). */
function supportedRanges(series: HistorySeries[]): { key: string; ms: number }[] {
  const times = series.flatMap((s) => s.points.map((p) => Date.parse(p.observedAt)));
  if (times.length < 2) return [];
  const span = Math.max(...times) - Math.min(...times);
  return RANGES.filter((r) => span >= r.ms).map((r) => ({ key: r.key, ms: r.ms }));
}

function Chart({ series }: { series: HistorySeries[] }) {
  const ranges = supportedRanges(series);
  const [range, setRange] = useState<{ key: string; ms: number } | null>(null);
  const cutoff = range === null ? null : latestMs(series) - range.ms;
  const all = series.map((s) => ({
    network: s.network,
    points: cutoff === null ? s.points : s.points.filter((p) => Date.parse(p.observedAt) >= cutoff),
  }));
  const W = 640;
  const H = 210;
  const PAD_L = 56;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 26;
  const times = all.flatMap((s) => s.points.map((p) => Date.parse(p.observedAt)));
  const values = all.flatMap((s) => s.points.map((p) => Number(p.pricedSubtotalUsd)));
  if (times.length === 0) return null;
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const v1 = Math.max(...values, 0);
  const x = (t: number) => (t1 === t0 ? (PAD_L + W - PAD_R) / 2 : PAD_L + ((t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R));
  const y = (v: number) => (v1 === 0 ? H - PAD_B : H - PAD_B - (v / v1) * (H - PAD_T - PAD_B));
  const axisUsd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : usd(String(v)));
  const axisTime = (t: number) => {
    const d = new Date(t);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${date} ${d.toISOString().slice(11, 16)} UTC`;
  };
  const yTicks = v1 === 0 ? [0] : [0, v1 / 2, v1];
  return (
    <div>
      <div className="ov2-ranges" role="group" aria-label="History range">
        {ranges.map((r) => (
          <button key={r.key} type="button" className={`chip${range?.key === r.key ? ' on' : ''}`} onClick={() => setRange(r)}>
            {r.key}
          </button>
        ))}
        <button type="button" className={`chip${range === null ? ' on' : ''}`} onClick={() => setRange(null)}>
          All
        </button>
      </div>
      {/* Per-series first/latest summary in body-size HTML: the chart stays
          interpretable on a 390px viewport where SVG text would scale down
          (reviewer G1 mobile pin, 2026-10-26). */}
      <ul className="ov2-series-summary">
        {all.filter((s) => s.points.length > 0).map((s) => {
          const first = s.points[0];
          const last = s.points[s.points.length - 1];
          return (
            <li key={s.network}>
              <span className={`ov2-swatch ov2-line-${s.network}`} aria-hidden="true" />
              {s.network}: {usd(first.pricedSubtotalUsd)} ({axisTime(Date.parse(first.observedAt))})
              {first.runId !== last.runId && <> to {usd(last.pricedSubtotalUsd)} ({axisTime(Date.parse(last.observedAt))})</>}
            </li>
          );
        })}
      </ul>
      <div className="ov2-chartgrid">
        {/* Y-axis value labels are HTML at a real font size - never scaled SVG text. */}
        <div className="ov2-yaxis" aria-hidden="true">
          {[...yTicks].reverse().map((v) => (
            <span key={v}>{axisUsd(v)}</span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="ov2-chart" role="img" aria-label="Recorded priced value in USD over time (UTC), one line per network">
        {yTicks.map((v) => (
          <line key={v} className="ov2-grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
        ))}
        {all.map((s) => (
          <g key={s.network}>
            {s.points.length > 1 && (
              <polyline
                fill="none"
                strokeWidth="1.5"
                className={`ov2-line ov2-line-${s.network}`}
                points={s.points.map((p) => `${x(Date.parse(p.observedAt))},${y(Number(p.pricedSubtotalUsd))}`).join(' ')}
              />
            )}
            {s.points.map((p) => (
              <circle key={p.runId} className={`ov2-dot ov2-line-${s.network}`} cx={x(Date.parse(p.observedAt))} cy={y(Number(p.pricedSubtotalUsd))} r="3.5">
                <title>
                  {`${s.network} - observed ${p.observedAt} (requested ${p.requestedAt}) - ${usd(p.pricedSubtotalUsd)}${p.legacy ? ' - older observation, may be incomplete' : ''}${p.unpricedCount > 0 ? ` - ${p.unpricedCount} unpriced` : ''}`}
                </title>
              </circle>
            ))}
          </g>
        ))}
        </svg>
        <div className="ov2-xaxis" aria-hidden="true">
          <span>{axisTime(t0)}</span>
          {t1 !== t0 && <span>{axisTime(t1)}</span>}
        </div>
      </div>
      <p className="muted caveat">
        Value of recorded positions at recorded times - not investment performance. Each network
        is its own line; every point is one actual recorded observation, never carried forward.
      </p>
      <details className="ov2-quiet">
        <summary>Every recorded point</summary>
        {/* B1 (reviewer, 2026-10-26): the table is wider than a 390px viewport;
            it scrolls INSIDE this region (keyboard-focusable) - the page never
            gains horizontal overflow. */}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable recorded-points table">
        <table className="ov2-table">
          <thead>
            <tr><th>Network</th><th>Observed</th><th>Requested</th><th>Priced value</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {all.flatMap((s) =>
              s.points.map((p) => (
                <tr key={p.runId}>
                  <td>{s.network}</td>
                  <td>{fmtTime(p.observedAt)}</td>
                  <td>{fmtTime(p.requestedAt)}</td>
                  <td>{usd(p.pricedSubtotalUsd)}</td>
                  <td>
                    {p.legacy ? 'older observation, may be incomplete' : ''}
                    {p.unpricedCount > 0 ? ` ${p.unpricedCount} unpriced` : ''}
                    {p.staleCount > 0 ? ` ${p.staleCount} stale price` : ''}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        </div>
      </details>
    </div>
  );
}

export function OverviewView() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const gen = useRef(0);
  const load = useCallback(async () => {
    const g = ++gen.current;
    const r = await fetchOverviewView();
    if (g === gen.current) setState(r);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') return <p className="muted">Loading recorded overview…</p>;
  if (state.kind !== 'ok' && state.kind !== 'empty')
    return (
      <div>
        <StateBlock kind={state.kind} />
        {/* Failed states keep a real recovery affordance (reviewer finding
            2026-10-26): Retry re-runs the actual fetch, never clears to fake data. */}
        {state.kind === 'failed' && (
          <button type="button" className="chip" onClick={() => void load()}>
            Retry
          </button>
        )}
      </div>
    );
  if (state.kind === 'empty')
    return (
      <div>
        <StateBlock kind="empty" reason={state.reason} />
        {state.history && state.history.some((s) => s.points.length > 0) && (
          <section className="panel">
            <h2>History</h2>
            <Chart series={state.history} />
          </section>
        )}
      </div>
    );

  const t = state.totals;
  return (
    <div>
      <section className="panel">
        <h2>
          Recognized priced portfolio value{' '}
          {t.grossPartial && <span className="tag">partial</span>}
        </h2>
        {t.grossPricedUsd === null ? (
          <p className="ov2-figure muted">
            Priced value unavailable - {t.unpricedAssetCount + t.staleAssetCount} recorded position
            {t.unpricedAssetCount + t.staleAssetCount === 1 ? '' : 's'} without a usable price.
          </p>
        ) : (
          <p className="ov2-figure">{usd(t.grossPricedUsd)}</p>
        )}
        {t.assetRowCount === 0 && t.grossPricedUsd === '0' && <p className="muted">No recorded asset positions.</p>}
        {t.grossPartial && (
          <p className="muted caveat">
            Partial: {t.unpricedAssetCount} unpriced, {t.staleAssetCount} stale price - excluded, never zero-valued.
          </p>
        )}
        <p className="muted">
          Latest complete observation {fmtTime(state.at)}; per-network times below. Recorded data only - no live lookup.
        </p>
      </section>

      <section className="panel">
        <h2>Recorded debt</h2>
        {t.debtState === 'none' && <p className="muted">No recorded debt.</p>}
        {t.debtState === 'priced' && <p className="ov2-figure">{usd(t.recordedDebtUsd)}</p>}
        {t.debtState === 'partially_unknown' && (
          <p className="muted caveat">Recorded debt includes unpriced items - its total is unknown.</p>
        )}
        {t.netUsd !== null && (
          <p className="ov2-net">
            Net of recorded debt{t.netPartial ? ' (known priced assets only)' : ''}: <strong>{usd(t.netUsd)}</strong>
          </p>
        )}
        {t.debtState === 'partially_unknown' && (
          <p className="muted caveat">Net cannot be determined - recorded debt includes unpriced items.</p>
        )}
      </section>

      <section className="panel">
        <h2>Allocation</h2>
        <div className="ov2-alloc">
          <div>
            <h3 className="ov2-h3">By network</h3>
            <table className="ov2-table">
              <tbody>
                {state.allocation.byNetwork.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{usd(r.valueUsd)}</td><td>{r.sharePct}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="ov2-h3">By category</h3>
            <table className="ov2-table">
              <tbody>
                {state.allocation.byCategory.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{usd(r.valueUsd)}</td><td>{r.sharePct}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="muted caveat">Shares of the priced subtotal only; debt is never in the mix.</p>
      </section>

      <section className="panel">
        <h2>History</h2>
        {state.history.every((s) => s.points.length === 0) ? (
          <p className="muted">History begins after your first recorded observation.</p>
        ) : (
          <Chart series={state.history} />
        )}
      </section>

      <section className="panel">
        <h2>Coverage</h2>
        <ul className="ov2-quiet">
          {state.networks.map((n) => (
            <li key={n.network}>
              {n.network}: latest observation {fmtTime(n.latestObservedAt)}
            </li>
          ))}
        </ul>
        <Caveats membership={state.recordedRunMembership} newerPartial={state.newerPartial} newerUnattributed={state.newerUnattributed} />
        {state.history.some((s) => s.points.some((p) => p.legacy)) && (
          <p className="muted caveat">History includes older observations that may be incomplete.</p>
        )}
      </section>
    </div>
  );
}
