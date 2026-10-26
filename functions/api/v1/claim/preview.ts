// LOCAL mount - mounting-package review pending; never deployed (uncommitted, unpushed).
// Flag gate before handler and before ANY database work; see server/claim/mount.ts.
import { handleClaimPreview, type ClaimDeps, type ClaimEnv } from '../../../../server/claim/routes';
import { claimDeps, claimMountGate } from '../../../../server/claim/mount';

export const onRequest = (
  { request, env }: { request: Request; env: ClaimEnv },
  deps: ClaimDeps = claimDeps,
) => {
  const blocked = claimMountGate(env, deps.id());
  if (blocked) return blocked;
  return handleClaimPreview(request, env, deps);
};
