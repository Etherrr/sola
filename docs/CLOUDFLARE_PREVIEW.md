# Sola Lens — Cloudflare Pages Free Preview

**Status:** code prepared, **not deployed**. WordPress and DNS unchanged.

## Important access boundary
Cloudflare Pages projects have a production `<project>.pages.dev` domain. Enabling **Access protection on preview deployments alone DOES NOT protect production**. Do not put the actual app on a public production branch until Access protection has been configured for **all reachable hostnames** and verified from a logged-out browser.

## Safe setup
1. Create a Cloudflare Free account. Link the GitHub repo `Etherrr/sola` to a Pages project.
2. Configure Next.js **static export**: Build command `npm run build`; output directory `out`; Node.js 24; no runtime secrets. This only supports the current demonstration app; it is **not** the later DeFi API architecture.
3. To avoid public exposure while configuring access controls, set the Pages production branch to a **separate placeholder branch** that contains only an innocuous non-sensitive holding page. Never deploy Sola Lens to production by default.
4. In Cloudflare Zero Trust, configure an Access application/policy for the Pages production hostname AND its preview aliases/wildcards. Enforce identity/email allowlisting. Cloudflare's **Preview deployment protection** may cover previews but NOT the production `pages.dev` address.
5. Deploy the static app from the GitHub testing branch only once Access protection is configured. Do not share the preview until anonymous/private browsing tests demonstrate that every alias and deep link is gated.
6. Check both `/`, `/portfolio/`, `/learn/`, `/settings/`, static JS/CSS assets, and any branch aliases while logged out, then repeat as an authorized tester. Look for bypassed URLs.
7. Preserve `solacapitalpartners.com` on WordPress. No custom domain/DNS change or public navigation link for this preview.

## Test locally or in GitHub CI
```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```
The `next.config.ts` now uses `output: 'export'` and trailing-slash URLs. `npm start` starts a loopback-only static test server, matching the `out` artifact and security header policy. A real deployment must verify that the `out/_headers` rules actually appear on Cloudflare responses.

## Exit checks
- CI green for the exact commit being deployed.
- Unauthorized requests blocked across **all** reachable domains and assets, including production alias.
- Authorized visits work on iOS/desktop, with visible SIMULATED notices, functional lessons and no signatures or wallet prompts.
- Access revocation and rollback tested. Review privacy/security expectations before exposing any real wallet data.
- No real DeFi connector code on this branch.

## Current deployment (2026-10-23 update)
The steps above describe the original plan. Current state:
- The preview is deployed on Cloudflare Pages and served at **https://app.solacapitalpartners.com**, behind the same Cloudflare Access application (email allowlist) as the `*.pages.dev` hosts. The allowlist is not recorded in this public repository.
- The Pages **production branch** is `feat/edu-01-network-journey`, not `main`. `main` is not deployed. A push to that branch deploys to the branded domain.
- The WordPress site is unchanged by this repository. DNS for the app host is a single CNAME on the external WordPress DNS.
- Rollback: use the Pages **Rollback** action on an earlier successful production deployment (the previous production build is retained), or detach the app hostname. Changing the production branch setting alone does not restore earlier content. Access protection should stay in place either way.
- Still untested: Access coverage of any future server (Functions) routes. The app has none today.
