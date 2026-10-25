import { handleEmailVerify, type NativeAuthEnv } from '../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleEmailVerify(request, env);
