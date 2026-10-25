import { assetAllocation, fmtPercent, money, symbolColor } from './model';
import { fixture } from './fixture';
import { Donut } from './donut';
export function Allocation() {
  const rows = assetAllocation(fixture.positions);
  const total = rows.reduce((a, r) => a + r.value, 0n);
  return (
    <section className="panel">
      <p className="eyebrow">PRICED GROSS ASSETS</p>
      <h2>Exposure by holding</h2>
      <p className="fine">
        Basis: {money(total)} of priced gross holdings (before debt, so not the net value above). A
        liquidity position is one holding and is not split into its tokens.
      </p>
      <div className="alloc-wrap">
        <Donut
          slices={rows.map((r) => ({
            label: r.symbol,
            percent: r.percent,
            roundedZero: r.roundedZero,
            share: r.share,
            color: symbolColor(r.symbol),
          }))}
          caption="holdings"
        />
        <ul className="alloc-list">
          {rows.map((r) => (
            <li key={r.assetId}>
              <i style={{ background: symbolColor(r.symbol) }} aria-hidden="true" />
              <span className="alloc-sym">{r.symbol}</span>
              <span className="alloc-val">{money(r.value)}</span>
              <span className="alloc-pct">{fmtPercent(r.percent, r.roundedZero)}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="fine">
        Excludes debt and unpriced holdings. Percentages are of the basis above. This is exposure,
        not a performance chart.
      </p>
    </section>
  );
}
