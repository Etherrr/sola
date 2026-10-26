import { handlePortfolioView, type ViewsEnv } from '../../../../server/portfolio/views-handler';

export const onRequest = ({ request, env }: { request: Request; env: ViewsEnv }) =>
  handlePortfolioView(request, env, 'risk');
