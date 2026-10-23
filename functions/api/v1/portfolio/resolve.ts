import { handleResolve, type Env } from '../../../../server/portfolio/handler';
export const onRequest = ({ request, env }: { request: Request; env: Env }) =>
  handleResolve(request, env);
