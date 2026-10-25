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
