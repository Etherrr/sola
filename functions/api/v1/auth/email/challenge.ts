import { handleEmailChallenge, type NativeAuthEnv } from '../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleEmailChallenge(request, env);
