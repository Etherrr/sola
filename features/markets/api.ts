// Browser network access for markets lives in features/portfolio/api-client.ts, the single
// approved module. Re-exported here for locality.
export {
  fetchOverview,
  parseOverviewSuccess,
  type OverviewOutcome,
} from '../portfolio/api-client';
