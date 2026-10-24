import { handleSession, type Env } from '../../../server/portfolio/handler';
export const onRequest = ({ request, env }: { request: Request; env: Env }) =>
  handleSession(request, env);
