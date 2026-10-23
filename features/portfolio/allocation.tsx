import { money, networkAllocation } from './model';
import { fixture } from './fixture';
export function Allocation() {
  const allocation = networkAllocation(fixture.positions);
  const ethereum = allocation.find((item) => item.network === 'Ethereum');
  return (
    <section className="panel">
      <p className="eyebrow">PRICED GROSS ASSETS</p>
      <h2>Allocation by network</h2>
      <div
        className="allocation-bar"
        role="img"
        aria-label={
          allocation.map((item) => `${item.network} ${item.percent} percent`).join(', ') +
          ' of priced gross assets'
        }
      >
        <span style={{ width: `${ethereum?.percent ?? 0}%` }} />
      </div>
      <div className="allocation-legend">
        {allocation.map((item) => (
          <span key={item.network}>
            <i className={item.network === 'Ethereum' ? 'gold-dot' : 'violet-dot'} />
            {item.network} · {money(item.value)} · {item.percent}%
          </span>
        ))}
      </div>
      <p className="fine">
        Excludes debt and unknown prices. This is exposure, not a performance chart.
      </p>
    </section>
  );
}
