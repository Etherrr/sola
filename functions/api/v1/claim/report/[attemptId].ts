// LOCAL mount - mounting-package review pending; never deployed (uncommitted, unpushed).
// Flag gate before handler and before ANY database work; see server/claim/mount.ts.
import { handleClaimReport, type ClaimDeps, type ClaimEnv } from '../../../../../server/claim/routes';
import { claimAttemptParam, claimDeps, claimMountGate } from '../../../../../server/claim/mount';

export const onRequest = (
  {
    request,
    env,
    params,
  }: {
    request: Request;
    env: ClaimEnv;
    params: Record<string, unknown>;
  },
  deps: ClaimDeps = claimDeps,
) => {
  const blocked = claimMountGate(env, deps.id());
  if (blocked) return blocked;
  return handleClaimReport(request, env, deps, claimAttemptParam(params));
};
