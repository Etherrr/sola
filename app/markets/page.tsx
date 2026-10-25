import { PageIntro } from '@/components/ui';
import { MARKET_METRICS } from '@/features/markets/model';

export const metadata = { title: 'Markets — source pending' };
export default function Markets() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="MARKETS · READ-ONLY" title="The wider market.">
        <p>Derivatives context, with coverage that stays visible.</p>
      </PageIntro>
      <div className="notice market-status">
        <span className="badge">DATA UNAVAILABLE</span>
        <p>
          No market source is connected. Figures will appear after a source is reviewed and
          approved.
        </p>
      </div>
      <div className="market-grid">
        {MARKET_METRICS.map((metric, i) => (
          <section
            key={metric.id}
            className="panel market-card"
            aria-labelledby={`market-${metric.id}`}
          >
            <p className="eyebrow">0{i + 1} / MARKET INDICATORS</p>
            <h2 id={`market-${metric.id}`}>{metric.title}</h2>
            <p className="market-empty">Not available</p>
            <p>{metric.detail}</p>
            <dl className="market-meta">
              <div>
                <dt>Source</dt>
                <dd>Not connected</dd>
              </div>
              <div>
                <dt>Coverage</dt>
                <dd>Not established</dd>
              </div>
              <div>
                <dt>Source updated</dt>
                <dd>Unavailable</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
      <p className="fine data-footer">
        A venue feed covers that venue only. Missing liquidation reports cannot establish that no
        liquidations occurred. Funding intervals and open-interest units can differ by instrument.
        No estimates, market-wide totals or historical charts are inferred.
      </p>
    </div>
  );
}
