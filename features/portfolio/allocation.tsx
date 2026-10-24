import { assetAllocation, money, symbolColor } from './model';
import { fixture } from './fixture';
import { Donut } from './donut';
export function Allocation() {
  const rows = assetAllocation(fixture.positions);
  return (
    <section className="panel">
      <p className="eyebrow">PRICED GROSS ASSETS</p>
      <h2>Allocation by asset</h2>
      <div className="alloc-wrap">
        <Donut
          slices={rows.map((r) => ({
            label: r.symbol,
            percent: r.percent,
            color: symbolColor(r.symbol),
          }))}
          caption="Sample"
        />
        <ul className="alloc-list">
          {rows.map((r) => (
            <li key={r.symbol}>
              <i style={{ background: symbolColor(r.symbol) }} aria-hidden="true" />
              <span className="alloc-sym">{r.symbol}</span>
              <span className="alloc-val">{money(r.value)}</span>
              <span className="alloc-pct">{r.percent}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="fine">
        Excludes debt and unknown prices. This is exposure, not a performance chart.
      </p>
    </section>
  );
}
