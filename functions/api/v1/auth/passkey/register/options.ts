import { handlePasskeyRegisterOptions } from '../../../../../../server/auth/webauthn';
import type { NativeAuthEnv } from '../../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handlePasskeyRegisterOptions(request, env);
