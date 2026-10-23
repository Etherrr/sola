# BASE-01: deployment and branch baseline

Recorded 2026-10-23 from read-only checks of GitHub and the Cloudflare dashboard. Hostnames, account IDs and Access allowlist entries are deliberately not recorded here because this repository is public; they are in the private handoff.

## Repository

- `main` is v0.1 (`c3396bf`). It does not contain `docs/V0_2_BUILD_SCOPE.md`.
- PR #3 (`chore/protected-preview-v0.1.1`, head `7555235`) adds static export and Cloudflare Pages preparation. It is open and unmerged.
- PR #4 (`docs/v0.2-live-observation-ux`, head `7bb3761`) adds the v0.2 scope docs. It is open and docs-only.
- PR #2 is closed and unmerged.
- Work in this series is **stacked on PR #3**. These branches are not ready to merge into `main` until PR #3 is reviewed and merged by the repository owner.

## Cloudflare Pages project `sola-lens-preview`

- Only successful served deployment: SHA `7555235` on `chore/protected-preview-v0.1.1`. No production deployment exists. Production branch is configured as `main`.
- Build command `npm run build`, output directory `out`, root directory blank (production and preview). Automatic builds on, preview builds for all non-production branches.
- No build hooks, variables, secrets or bindings were shown.
- Builds of `docs/v0.2-live-observation-ux` compile and type-check, then fail with "Output directory out not found". That branch has no static export configuration and no `functions/` directory.
- Compatibility date 2026-10-23. Functions fail-open is configured in quota mode; that is not evidence of how Access treats Functions.
- **No functional API endpoint has been verified. Coverage of future Functions by Access is untested.**

## Access

- A single Access rule covers the primary and wildcard Pages hostnames for all paths and allows exactly four named emails. Signed-out requests for `/index.html`, `/index.txt` and uploaded `_next/static` assets redirect to Access with no content returned.
- Not yet tested: a Functions route, preview aliases for newly created branches, and deep links. Each new preview branch must be checked signed-out before anyone relies on it.

## Costs and limits (checked 2026-10-23)

- Workers Free: 100,000 requests/day, 10 ms CPU per request. Zero Trust Free: $0 per seat, up to 50 seats. Pages Free: 500 builds/month. Static requests are free and unlimited; Functions share the Workers quota.
- Sources: https://developers.cloudflare.com/pages/functions/pricing/ , https://developers.cloudflare.com/pages/platform/limits/ , https://pages.cloudflare.com/

## Consequence for this work

Every push to a non-production branch can start an automatic preview build. These branches contain simulated content only. No live-data endpoint, provider key or wallet permission is included.
