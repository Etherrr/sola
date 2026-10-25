/** No vendor is selected. Units, windows and coverage must survive every future adapter. */
export const MARKET_METRICS = [
  {
    id: 'overview',
    title: 'Market overview',
    detail: 'Prices and market context for explicitly covered instruments.',
  },
  {
    id: 'funding',
    title: 'Funding rates',
    detail: 'Perpetual funding with venue, settlement interval and rate units.',
  },
  {
    id: 'open-interest',
    title: 'Open interest',
    detail: 'Outstanding exposure with contract, base-asset or quote-currency units.',
  },
  {
    id: 'liquidations',
    title: 'Liquidations',
    detail: 'Reported forced closures with venue coverage and reporting window.',
  },
] as const;
export type MetricId = (typeof MARKET_METRICS)[number]['id'];
export type MarketObservation = {
  metric: MetricId;
  instrument: string;
  value: string; // exact decimal; no floating-point financial arithmetic
  unit: string;
  venues: string[];
  source: string;
  sourceUpdatedAt: string;
  responseCompletedAt: string;
  window: { start: string; end: string } | null;
  fundingIntervalHours: number | null;
  coverage: 'venue-only' | 'selected-venues';
  warnings: string[];
};
export type MarketResult =
  | { status: 'unavailable'; reason: 'source-not-approved'; observations: [] }
  | { status: 'available'; observations: MarketObservation[]; staleAfterSeconds: number };

/**
 * M-MARKETS-1: on-chain price cards for a fixed Solana instrument allowlist. These types are
 * deliberately separate from MARKET_METRICS / MarketObservation above: a venue price is not a
 * funding rate, open-interest figure or liquidation report, and none of those fields are reused
 * to carry it.
 */
export type PriceKind = 'native-asset' | 'tokenized-equity';

export type PriceObservation = {
  metric: 'overview';
  instrument: string;
  name: string;
  kind: PriceKind;
  issuer: string | null;
  underlying: string | null;
  chain: 'solana';
  mint: string;
  /** Exact decimal USD string copied verbatim from the venue feed; never float-derived. */
  value: string;
  unit: 'USD';
  /** Venue of the displayed price (highest-liquidity qualified pool). */
  primaryVenue: string;
  primaryPairAddress: string;
  venues: string[];
  venueCount: number;
  /** Whole-dollar approximation for display context; ranking input, never a quote. */
  liquidityUsdApprox: string;
  /** max-to-min spread across qualified venues, percent, 2-dp decimal string; null when < 2 venues. */
  dispersionPct: string | null;
  source: 'DexScreener';
  /** DexScreener exposes no feed timestamp. Always null; UI says "Retrieved", never "Updated". */
  sourceUpdatedAt: null;
  coverage: 'selected-venues';
  warnings: string[];
};

export type UnpricedInstrument = { instrument: string; reason: string };

export type MarketOverviewResult =
  | { status: 'unavailable'; reason: 'source-error'; observations: [] }
  | {
      status: 'available';
      source: 'DexScreener';
      observations: PriceObservation[];
      unpriced: UnpricedInstrument[];
      /** True when the source failed and these are the last good values, labeled in the UI. */
      stale: boolean;
      /** Response-completion time of the upstream batch these values came from. */
      retrievedAt: string;
      cacheAgeSeconds: number;
      staleAfterSeconds: number;
    };
