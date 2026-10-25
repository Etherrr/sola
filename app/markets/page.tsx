import { PageIntro } from '@/components/ui';
import { MARKET_METRICS } from '@/features/markets/model';
import { OverviewPanel } from '@/features/markets/overview-panel';

export const metadata = { title: 'Markets' };
export default function Markets() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="MARKETS · READ-ONLY" title="The wider market.">
        <p>
          On-chain prices for a fixed, named list of Solana instruments, then derivatives
          context. Coverage is always stated; nothing is inferred.
        </p>
      </PageIntro>
      <OverviewPanel />
      <div className="market-grid">
        {MARKET_METRICS.filter((m) => m.id !== 'overview').map((metric, i) => (
          <section
            key={metric.id}
            className="panel market-card"
            aria-labelledby={`market-${metric.id}`}
          >
            <p className="eyebrow">0{i + 2} / MARKET INDICATORS</p>
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
        Prices come from selected Solana DEX pools reported by DexScreener and cover those pools
        only, not the whole financial market. Tokenized equities are on-chain tokens issued by
        Backed (xStocks); they are not the underlying stocks and can trade above or below them. A
        venue feed covers that venue only. Missing liquidation reports cannot establish that no
        liquidations occurred. No estimates, market-wide totals or historical charts are
        inferred, and a missing price is never shown as zero.
      </p>
    </div>
  );
}
