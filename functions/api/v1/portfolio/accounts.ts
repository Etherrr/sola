import { handleAccounts, type AccountsEnv } from '../../../../server/accounts/handler';
import { fetchAccessKeys } from '../../../../server/portfolio/access';

export const onRequest = ({ request, env }: { request: Request; env: AccountsEnv }) =>
  handleAccounts(request, env, {
    fetchKeys: fetchAccessKeys,
    now: () => new Date(),
    id: () => crypto.randomUUID(),
    bodyDeadlineMs: 3000,
  });
