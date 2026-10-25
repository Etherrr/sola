import { handleNativeLogout } from '../../../../../server/auth/session-info';
import type { NativeAuthEnv } from '../../../../../server/auth/email';

export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleNativeLogout(request, env);
