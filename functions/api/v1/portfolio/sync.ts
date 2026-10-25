import { handleSync, type SyncEnv } from '../../../../server/portfolio/sync';
export const onRequest = ({ request, env }: { request: Request; env: SyncEnv }) =>
  handleSync(request, env);
