import type { MarketOverviewResult, PriceObservation } from './model';

type Available = Extract<MarketOverviewResult, { status: 'available' }>;

const shortMint = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-CA', { hour12: false, timeZone: 'UTC' }) + ' UTC';

const fmtLiquidity = (wholeDollars: string) => {
  const n = Number(wholeDollars);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 1_000_000) return `≈ $${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `≈ $${Math.round(n / 1_000)}K`;
  return `≈ $${Math.round(n)}`;
};

const WARNING_COPY: Record<string, string> = {
  'single-venue': 'One venue only',
  'wide-dispersion': 'Venue prices differ',
  'few-pools': 'Few pools',
};

function PriceCard({ o }: { o: PriceObservation }) {
  return (
    <section className="panel market-card price-card" aria-labelledby={`price-${o.instrument}`}>
      <p className="eyebrow">
        {o.kind === 'tokenized-equity' ? `TOKENIZED EQUITY · ${o.issuer}` : 'SOLANA NATIVE ASSET'}
      </p>
      <h2 id={`price-${o.instrument}`}>
        {o.instrument} <span className="price-name">{o.name}</span>
      </h2>
      <p className="price-value">${o.value}</p>
      {o.kind === 'tokenized-equity' ? (
        <p className="price-note">
          An on-chain token that tracks {o.underlying}. It is not the stock itself and can trade
          above or below it.
        </p>
      ) : (
        <p className="price-note">Priced through wrapped SOL on Solana venues.</p>
      )}
      {o.warnings.length > 0 && (
        <p className="price-warnings">
          {o.warnings.map((w) => (
            <span key={w} className="chip chip-warn">
              {WARNING_COPY[w] ?? w}
            </span>
          ))}
        </p>
      )}
      <dl className="market-meta">
        <div>
          <dt>Price venue</dt>
          <dd>
            {o.primaryVenue}
            {o.venueCount > 1 ? ` (+${o.venueCount - 1} more)` : ''}
          </dd>
        </div>
        <div>
          <dt>Venue spread</dt>
          <dd>{o.dispersionPct === null ? 'One venue' : `${o.dispersionPct}%`}</dd>
        </div>
        <div>
          <dt>Pool liquidity</dt>
          <dd>{fmtLiquidity(o.liquidityUsdApprox)}</dd>
        </div>
        <div>
          <dt>Token mint</dt>
          <dd>{shortMint(o.mint)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function OverviewView({
  data,
  nowMs,
  onRefresh,
  refreshing,
}: {
  data: Available;
  /** Render clock from the panel; lets the age and stale label advance without any network polling. */
  nowMs: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const ageSec = Math.max(0, Math.floor((nowMs - Date.parse(data.retrievedAt)) / 1000));
  const aged = ageSec > data.staleAfterSeconds;
  const stale = data.stale || aged;
  return (
    <div className="price-overview">
      <div className="notice market-status">
        <span className="badge">{stale ? 'STALE VALUES' : 'LIVE ON-CHAIN'}</span>
        <p>
          {data.stale
            ? 'The price source is unreachable. These are the last good values, kept visible rather than blanked.'
            : aged
              ? `These values are older than their ${data.staleAfterSeconds}s freshness window. Refresh to re-check the venues.`
              : `On-chain prices from selected Solana venues via ${data.source}. Those pools are the coverage; this is not the whole market.`}
        </p>
        <p className="fine">
          Retrieved {fmtClock(data.retrievedAt)} · {ageSec}s ago · refreshes on view, at most
          every {data.staleAfterSeconds}s
        </p>
        <button type="button" className="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh prices'}
        </button>
      </div>
      <div className="market-grid">
        {data.observations.map((o) => (
          <PriceCard key={o.instrument} o={o} />
        ))}
      </div>
      {data.unpriced.length > 0 && (
        <p className="fine data-footer">
          Not priced this refresh:{' '}
          {data.unpriced.map((u) => `${u.instrument} (${u.reason})`).join(', ')}. A missing price
          is never shown as zero.
        </p>
      )}
    </div>
  );
}

export function OverviewMessage({
  title,
  body,
  retry,
  onRetry,
}: {
  title: string;
  body: string;
  retry: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="notice market-status">
      <span className="badge">DATA UNAVAILABLE</span>
      <p>{title}</p>
      <p className="fine">{body}</p>
      {retry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
