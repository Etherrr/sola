import { handleWalletLinkVerify } from '../../../../../../../server/auth/wallet';
import type { NativeAuthEnv } from '../../../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleWalletLinkVerify(request, env, 'solana');
