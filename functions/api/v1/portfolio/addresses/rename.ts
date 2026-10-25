import { handleAddressRename } from '../../../../../server/portfolio/addresses';
import type { NativeAuthEnv } from '../../../../../server/auth/email';

export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleAddressRename(request, env);
