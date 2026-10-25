import {
  handleAddressesList,
  handleAddressAdd,
} from '../../../../server/portfolio/addresses';
import type { NativeAuthEnv } from '../../../../server/auth/email';

export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  request.method === 'GET' ? handleAddressesList(request, env) : handleAddressAdd(request, env);
