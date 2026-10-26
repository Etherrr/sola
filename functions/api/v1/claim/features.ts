// LOCAL mount - /account integration-prep review pending; never deployed.
// DELIBERATELY NOT behind claimMountGate: this IS the discovery mechanism the
// client uses to learn whether the gate is open. Config-only handler - no
// session, assertion, or database work (server/claim/features.ts).
import { handleClaimFeatures } from '../../../../server/claim/features';
import type { ClaimEnv } from '../../../../server/claim/routes';

export const onRequest = ({ request, env }: { request: Request; env: ClaimEnv }) =>
  handleClaimFeatures(request, env);
