import { handleOverview, type Env } from '../../../../server/markets/handler';
export const onRequest = ({ request, env }: { request: Request; env: Env }) =>
  handleOverview(request, env);
