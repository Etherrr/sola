import { handlePortfolioView, type ViewsEnv } from '../../../../server/portfolio/views-handler';

// Plan 6.1 Overview page wire. NOTE: /api/v1/portfolio/overview is the
// slice-1 What-changed route (handleOverview) - the page view lives here.
export const onRequest = ({ request, env }: { request: Request; env: ViewsEnv }) =>
  handlePortfolioView(request, env, 'overview');
