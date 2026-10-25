import { handleOverview, type OverviewEnv } from '../../../../server/portfolio/overview-handler';

export const onRequest = ({ request, env }: { request: Request; env: OverviewEnv }) =>
  handleOverview(request, env);
