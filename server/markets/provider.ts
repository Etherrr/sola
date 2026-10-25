import type { MarketResult } from '../../features/markets/model';

/** Server-side seam only. Live implementations require source/terms/credential approval. */
export interface MarketProvider {
  read(signal: AbortSignal): Promise<MarketResult>;
}
export const unconfiguredMarketProvider: MarketProvider = {
  async read() {
    return { status: 'unavailable', reason: 'source-not-approved', observations: [] };
  },
};
