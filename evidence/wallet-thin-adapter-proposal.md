# Proposed thin wallet adapter diff, NOT APPLIED

Eight explicit function files are proposed only after exact review/gate. No wildcard chain coercion or shared unvalidated path dispatch. Each exports onRequest taking Request and NativeAuthEnv, and returns the selected handler(request, env, literal chain). No new env flags, secrets, migrations, provider calls or changes to entitlement/Access/claim/legacy policy.

| New path under functions/api/v1/auth/wallet | Handler from server/auth/wallet | Chain |
|---|---|---|
| evm/challenge.ts | handleWalletChallenge | evm |
| evm/verify.ts | handleWalletVerify | evm |
| evm/link/challenge.ts | handleWalletLinkChallenge | evm |
| evm/link/verify.ts | handleWalletLinkVerify | evm |
| solana/challenge.ts | handleWalletChallenge | solana |
| solana/verify.ts | handleWalletVerify | solana |
| solana/link/challenge.ts | handleWalletLinkChallenge | solana |
| solana/link/verify.ts | handleWalletLinkVerify | solana |

Normal challenge/verify imports use ../../../../../../server/auth/wallet and email; link imports use ../../../../../../../server/auth/wallet and email. Verify import paths by typecheck and exact tests before review.

Example proposed content for evm/challenge.ts:

```ts
import { handleWalletChallenge } from '../../../../../../server/auth/wallet';
import type { NativeAuthEnv } from '../../../../../../server/auth/email';
export const onRequest = ({ request, env }: { request: Request; env: NativeAuthEnv }) =>
  handleWalletChallenge(request, env, 'evm');
```

The next exact adapter packet must test all eight imported mounts, assert path-to-handler/chain mapping, reject wrong method/origin/oversize/replay, and retain existing middleware no-store behavior. Local HTTPS evidence before mount is middleware + direct handler dispatch, not proof of Cloudflare Pages route mapping. No live release should be inferred from this proposal.
