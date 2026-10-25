import {
  handleSnapshotConsentStatus,
  handleSnapshotConsentChange,
} from '../../../../../server/portfolio/consent';
import type { NativeAuthEnv } from '../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  request.method === 'GET'
    ? handleSnapshotConsentStatus(request, env)
    : handleSnapshotConsentChange(request, env);
