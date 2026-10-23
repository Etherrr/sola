import { handleHealth, type Env } from '../../../server/portfolio/handler';
export const onRequest = ({ request, env }: { request: Request; env: Env }) =>
  handleHealth(request, env);
