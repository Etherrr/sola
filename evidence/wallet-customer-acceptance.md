# Local customer wallet integration acceptance

Scope: local production static export, mounted customer sign-in/create-account and account panel, injected synthetic EVM/Solana wallets, actual auth/session/address-list handlers and in-memory SQLite. No functions route files, deployment, production data, browser extension or physical device are changed or exercised.

Base: 1b32a03da6b33583c1922136a1bdf0a82a7470ad.

Run from repository root:

```
npm ci
npm run build
npm run verify:export
npx vitest run --config e2e/vitest.wallet.config.mjs
npm run lint
npm run typecheck
npm test
```

The browser suite uses test-only Chromium through Playwright and a static server on 127.0.0.1:3097, then routes https://preview.test requests to the export/handlers. Chromium must already be installed (`npx playwright install chromium` where needed). Handler request origin is preview.test. This is not an HTTPS deployment or an extension integration test. Static redirects are followed by the proxy, compressed transport headers are removed after Node fetch decompresses the body, and cookie state is carried in the harness. Browser cookie storage/Cloudflare function mounting are not verified here.

28 cases:
- EVM/Solana x desktop/390px phone x sign-in/link x success/pending-challenge navigation/ambiguous verify response (24).
- Sign-in/create-account idle customer pages x desktop/phone (4).

Assertions include no proof after connection or clear/reconnect; duplicate synchronous clicks yield one challenge/signature/verify; navigation before the challenge completes yields no signature; success Continue resumes the requested native route; non-invited wallet session has native identity but portfolio guard returns403; linked book reload shows Verified and the exact canonical address. Unknown verify responses lock retry and reconcile only through full account navigation; the test deliberately replaces an actual accepted response to exercise a potentially committed result. All customer cases assert zero page errors. Idle pages assert hydrated passkey availability without any wallet request.

A pre-existing hydration mismatch in passkey support rendering was exposed by the actual sign-in test. The support snapshot now uses useSyncExternalStore with a false server snapshot and the browser support check after hydration. No passkey ceremony is run by this suite. A separate previously reviewed virtual-authenticator test exists on local/native-auth-acceptance, not merged here.

Earlier failed evidence is retained separately: test proxy redirect handling and full-address text assumptions were corrected; strengthening canonical EVM address checks initially used checksum rather than stored lowercase and failed, then was corrected to the actual book contract. Failures are not counted as passes.

Screenshots are local synthetic fixtures. Phone full-page screenshots include the fixed bottom navigation at its viewport position; the actual viewport is scrollable. No content is claimed to be a live wallet balance or physical-device acceptance.

Remaining release gates: exact independent customer review; separately reviewed function mounts; current configuration/security read-back; genuine extension/device wallet behavior; physical passkey behavior; production/D1 concurrency and post-release acceptance. Existing 13 variables, Access23, prod44f, claim and legacy ownership bridge must remain unchanged unless separately reviewed.

## Followup local secure browser packet

New e2e/wallet-secure.spec.ts runs the real functions/_middleware onRequest, then existing actual handlers and the production export behind an HTTPS server bound to127.0.0.1:3447, with static server3098. No functions route files are mounted. A temporary one-day localhost certificate is generated with openssl and removed after tests. Only the browser context ignores that local certificate; no process-wide TLS override, production cookie or real key is used.

Run `npx vitest run --config e2e/vitest.secure-wallet.config.mjs` after build. Requires openssl and local Playwright Chromium.

Twelve synthetic cases: EVM/Solana x desktop/phone x uninvited sign-in/invited existing wallet identity/same-owner link. The browser genuinely stores/sends the Secure HttpOnly SameSite=Lax host-only session cookie through HTTPS. Tests check final protected HTML200 for invited accounts,403 and no requested protected HTML for uninvited accounts, API403, a recovery link to public sign-in, actual account-menu logout, cookie removal and session401. Wrong-method/origin requests set no cookie. Link uses a seeded local invited email session as its starting browser cookie; wallet sign-in cases never inject their session cookie.

Success copy now says Continue checks preview access, not that invitation is guaranteed. HTML denial is a minimal fixed403 document with a public sign-in recovery link, no reflected path/identity/data/scripts/styles and a strict CSP. Plain denial remains for RSC/non-HTML/explicit data suffixes. Entitlement status and admission behavior are unchanged. Invited risk-route HTML acceptance is not balances-provider acceptance: unrelated data APIs are deliberately unavailable in the local harness. The test then visits the actual account page to confirm the signed-in shell.

This is local middleware/direct-handler proof, not exact Cloudflare route mounting or production deployment. Physical extension/device/passkey and D1-specific concurrency remain separate.

## Combined virtual passkey regression

The previously accepted actual-customer virtual-authenticator scenario is included on this combined local branch with desktop and390px phone cases. The harness automatically creates/removes a temporary localhost certificate, admits HTML through current middleware, seeds only a local invited session/entitlement for registration, and uses actual passkey handlers. Covers no-credential honest error, account-menu registration, stale registration reauthentication refusal, discoverable login from cleared browser cookies, final protected Overview HTML200 and native label, stored secure cookie fields and zero page errors. Run `npx vitest run --config e2e/vitest.ui.config.mjs` after build; uses HTTPS8787 and static3099.

This is Chromium's virtual authenticator at two viewport sizes, not a real phone/passkey provider. A virtual registration context and local seed route are test-only. Unrelated portfolio-provider APIs are unavailable in this harness; the recorded Overview error does not claim balances acceptance. No functions files or production effects are added.

## Local literal-chain function mounts

Eight thin function adapters now exist locally under functions/api/v1/auth/wallet/{evm,solana}/{challenge,verify,link/challenge,link/verify}. Each imports the existing matching handler and passes a literal chain. No guard/config/migration/provider changes. Exact imported adapter tests cover all four flows: bound chain message, successful proof, same-owner verified link or secure sign-in cookie, consumed replay rejection with no cookie. Each of eight adapters checks exact method405/origin403/oversize413 and flag-off503, with no cookie/no-store. Initial negative test omitted JSON content type and link cookie and correctly hit415/401; fixed fixture parameters, not handler gates. Failed run retained.

The secure HTTPS browser suite now dispatches its wallet paths to those actual eight imported onRequest functions after the actual middleware, rather than selecting direct handlers. Still local Node/SQLite, not deployed Cloudflare Pages path routing/workerd/D1 binding evidence. Other28case and virtual2case suites remain local regression evidence. No remote push or deployment is part of this packet.
