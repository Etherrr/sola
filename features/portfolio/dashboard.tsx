import Link from 'next/link';
import { Allocation } from './allocation';
import { PositionTable } from './position-table';
import { PageIntro, SimulatedNotice } from '@/components/ui';
import { CombinedWallets } from './combined-wallets';
import { fixture } from './fixture';
import { money, summarize, uniqueExposures } from './model';
type View = 'overview' | 'assets' | 'positions' | 'risk';
const views: { id: View; label: string; href: string }[] = [
  { id: 'overview', label: 'Overview', href: '/portfolio' },
  { id: 'assets', label: 'Assets', href: '/portfolio/assets' },
  { id: 'positions', label: 'Positions', href: '/portfolio/positions' },
  { id: 'risk', label: 'Risk insights', href: '/portfolio/risk' },
];
export function Dashboard({ view = 'overview' }: { view?: View }) {
  const totals = summarize(fixture.positions);
  const positions = uniqueExposures(fixture.positions);
  const assets = positions.filter((item) => item.kind === 'Wallet');
  const defi = positions.filter((item) => item.kind !== 'Wallet');
  return (
    <div className="page-container">
      <SimulatedNotice />
      <PageIntro
        eyebrow="DEMO · ALL NETWORKS"
        title={
          view === 'risk'
            ? 'Risk insights'
            : view === 'assets'
              ? 'Assets'
              : view === 'positions'
                ? 'Positions'
                : 'Overview'
        }
      >
        <p>Invented Ethereum and Solana holdings, not your wallet.</p>
      </PageIntro>
      <nav className="tabs" aria-label="Portfolio views">
        {views.map((item) => (
          <Link key={item.id} href={item.href} aria-current={view === item.id ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      {view === 'overview' ? <CombinedWallets /> : null}
      {view === 'overview' ? (
        <p className="notice demo-divider">
          Below is the original standalone demo fixture (basis $12,000). It is a separate
          invented example: it is not an input to, and does not reconcile with, the combined
          view above.
        </p>
      ) : null}
      <div className="metric-grid">
        <div className="metric main-metric">
          <p>Priced net sample value</p>
          <strong>{money(totals.net)}</strong>
          <span className="badge">INCOMPLETE · {totals.unpriced} UNPRICED ASSET</span>
          <small>Priced assets less debt; excludes unknown values</small>
        </div>
        <div className="metric">
          <p>Priced sample assets</p>
          <strong>{money(totals.assets)}</strong>
          <small>Wallet + supplied + liquidity exposure</small>
        </div>
        <div className="metric">
          <p>Sample borrowed debt</p>
          <strong className="debt">−{money(totals.debt)}</strong>
          <small>A liability, subtracted from assets</small>
        </div>
      </div>
      <p className="notice">
        DEMO has no sample price. Its value is unknown, so these totals are incomplete. LP receipts
        are excluded to avoid counting the same exposure twice.
      </p>
      {view === 'risk' ? (
        <div className="risk-grid">
          <section className="panel">
            <span className="badge">CONCENTRATION</span>
            <h2>Ethereum: 58.3%</h2>
            <p>
              $7,000 of $12,000 priced gross sample assets are on Ethereum. Allocation excludes debt
              and the unpriced token. Correlated exposures can still amplify losses.
            </p>
          </section>
          <section className="panel">
            <span className="badge">BORROWING</span>
            <h2>Debt changes the picture</h2>
            <p>
              The example owes $1,000 USDC. Liquidation thresholds and health factors are
              unavailable in this fixture; no safety score is inferred.
            </p>
          </section>
          <section className="panel">
            <span className="badge">COVERAGE GAP</span>
            <h2>Unknown stays unknown</h2>
            <p>
              There is no live source, APY, historical P&amp;L, cost basis, or complete protocol
              coverage. Liquidity is represented once at its sample aggregate value.
            </p>
          </section>
          <section className="panel">
            <p className="eyebrow">RISK CONTEXT</p>
            <h2>Return is only half the story.</h2>
            <p>
              Contract, liquidity, staking, and liquidation risks are not covered by this sample.
            </p>
          </section>
        </div>
      ) : (
        <>
          {view === 'overview' && (
            <div className="dashboard-split">
              <Allocation />
              <section className="panel insight">
                <p className="eyebrow">LENS NOTE</p>
                <h2>A balance is a starting point.</h2>
                <p>
                  What sits in a wallet and what is owed tell different stories; read them
                  together.
                </p>
              </section>
            </div>
          )}
          <section className="panel holdings">
            <div className="section-heading">
              <h2>
                {view === 'assets'
                  ? 'Wallet assets'
                  : view === 'positions'
                    ? 'DeFi positions'
                    : 'Sample holdings'}
              </h2>
              <span className="badge">SIMULATED</span>
            </div>
            <PositionTable
              positions={view === 'assets' ? assets : view === 'positions' ? defi : positions}
            />
            {view === 'positions' && (
              <p className="fine">
                LP receipt: 10 units, representing the displayed SOL / USDC position. Excluded from
                totals. Protocol identities are fictional; no provider or compatibility is implied.
              </p>
            )}
          </section>
        </>
      )}
      <footer className="data-footer">
        <p>
          Source: {fixture.source}
          <br />
          Fixed fixture reference: <time dateTime={fixture.observedAt}>2026-10-23 00:00 UTC</time> ·
          not a live observation
        </p>
        <p>
          Coverage: invented Ethereum and Solana examples only.
          <br />
          All amounts in USD. No refresh or external requests.
        </p>
      </footer>
    </div>
  );
}
