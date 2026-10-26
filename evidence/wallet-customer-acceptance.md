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
