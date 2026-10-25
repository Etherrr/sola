import { handleAddressRemove } from '../../../../../server/portfolio/addresses';
import type { NativeAuthEnv } from '../../../../../server/auth/email';

export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleAddressRemove(request, env);
