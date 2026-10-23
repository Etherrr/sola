# Sola Lens v0.1.1 — Protected Live Preview

**State:** superseded hosting option; see [Cloudflare Free Preview](CLOUDFLARE_PREVIEW.md) for the selected zero-subscription testing approach. No deployment completed. An actual protected deployment requires the owner's Vercel account connection and verified access settings.

## Scope and boundaries
- Deploy the existing **simulated v0.1** app from the GitHub `main` branch to an isolated HTTPS preview.
- No wallet access, address input, blockchain provider API, real funds, production WordPress changes, or DNS changes.
- The preview must be **host-protected**, not just `noindex` or a client-rendered password page.
- Keep `solacapitalpartners.com` unchanged and the WordPress app-launch switch **off**.
- Use the Vercel commercial-compatible plan and check current plan/deployment protection availability directly in the account.

## Owner action (hosting)
1. Connect Vercel to the `Etherrr/sola` GitHub repository and authorize access.
2. Create a new Next.js project, with root directory `/`, framework preset Next.js, and the existing `npm` lockfile. Use the repo's default build command; do not invent runtime secrets. The app requires no environment variables at v0.1.
3. **Before generating or sharing a reachable preview**, configure **Security → Deployment Protection** to require Vercel Authentication for the relevant preview deployment(s). Ensure protection covers deployment assets and every route. If access-wall configuration cannot be confirmed, do not share the URL.
4. Use a Vercel-generated `*.vercel.app` preview URL initially. Do not attach `app.solacapitalpartners.com`, change WordPress DNS, or expose a public launch CTA.
5. Restrict tester access to named accounts or another reviewed hosting-level method. Avoid shareable/public bypass links.
6. Verify using a private browsing session without credentials: root, `/portfolio`, `/learn`, `/settings`, `/_next/static/...`, and any deployed aliases must be inaccessible. Repeat with an authorized tester and verify successful navigation.
7. Record the protected preview URL and protection state in a **private** release record; do not put secret/bypass URLs or account tokens into GitHub.

**If a Vercel connection is unavailable:** deployment is **blocked**. Only document the configuration and exact owner steps. Never mark it live or protected without testing.

## Preview smoke test
- Load `/`, `/start`, `/start/security`, `/connect`, `/portfolio`, `/portfolio/assets`, `/portfolio/positions`, `/portfolio/risk`, `/settings` on desktop and mobile.
- Verify welcome card links, lesson navigation and quiz feedback, wallet guidance, optional local progress saving/clearing, accessible keyboard navigation and responsive tables.
- Check the persistent **SIMULATED** warning, exact debt subtraction, unknown-price warning and absence of real data/API interactions.
- Verify no signing, wallet-connect dialogs, private key entry, transactions, unreviewed redirects or third-party analytics.
- Inspect browser console, network errors and HTTP response headers in production mode.
- Run `npm ci`, `npm run format:check`, `npm run check`, `npm run test:e2e`, `npm audit --audit-level=high` against the approved source commit as part of CI.
- Perform manual Safari/Firefox and actual iOS/Android checks; automated Chromium alone is insufficient for release.

## Security and release checks
- `robots: noindex` and `X-Robots-Tag` prevent indexing but **are not authentication**.
- The app's current CSP allows inline scripts/styles required by the framework. Nonce/hash CSP tightening belongs in a separately reviewed security hardening PR; do not break hydration as part of deployment.
- Check that **production** deployment and default `*.vercel.app` aliases are not accidentally reachable if the intent is private-only access; do not assume restricting previews also protects production URLs.
- Do not store any sensitive wallet/public address telemetry. The v0.1 app is demo-only.
- Preserve a rollback: Vercel project access restriction or unpublish/disconnect the preview, then roll back to the last known-good deployment. Do not change WordPress launch status.

## Exit criteria for v0.1.1
- A real HTTPS preview URL has been recorded privately.
- Unauthorized routes and assets are proven inaccessible; authorized routes work.
- CI succeeds for the deployed commit; manual device QA and simulated-only checks are signed off.
- Owner accepts the preview for invited testing. This is **not** authorization to launch the app publicly or begin real DeFi functionality.

## Future Codex handoff
The next phase involving real EVM/Solana address lookup, DeFi position normalization, wallet discovery, security risk modeling, compatibility matrices and external data providers remains **out of scope** here and should be conducted in a separate, security-reviewed Codex implementation and PR.
