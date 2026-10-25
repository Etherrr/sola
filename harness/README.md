# Local contract harness — UI against real handlers on local workerd D1

SANDBOX ONLY. Nothing here ships. This qualifies the browser-to-handler-to-D1 contract
locally before anyone decides on a real binding. It is not production qualification.

What is REAL in this harness:
- server/accounts/handler.ts handleAccounts, server/portfolio/handler.ts handleSession,
  server/portfolio/access.ts checkAccessJwt — the unchanged production code paths.
- The D1 adapter, limiter and migrations/0001 SQL, executed by a real workerd runtime
  (Miniflare) against a local in-memory D1 binding.
- The browser: the actual static export, driven by Playwright, talking over real HTTP.

What is FIXTURE (and would be Cloudflare Access in production):
- The RS256 keypair is generated locally at startup; /fixture/mint signs JWTs for synthetic
  identities (user-a/user-b). The JWT is still genuinely verified by the unchanged jose
  verifier through the handlers' existing fetchKeys dependency seam. Production JWT code is
  not weakened or bypassed.
- The Playwright proxy plays the Access edge: it forwards /api/v1/portfolio/accounts and
  /api/v1/session to the fixture worker, injecting cf-access-jwt-assertion and rewriting
  Origin/Referer to the fixture origin (the handler's same-origin check correctly rejects
  cross-origin calls — the edge must present its own origin).
- /api/v1/health and /api/v1/portfolio/resolve stay stubbed (not under test).

Setup (from the sola repo root, patch applied):
  cd harness && npm install        # miniflare, esbuild, jose
  # Edit the three /tmp/sola-repo import paths in fixture-worker.ts to the repo path,
  # then: npx esbuild fixture-worker.ts --bundle --format=esm --platform=neutral --outfile=fixture-worker.mjs
  node serve.mjs                   # fixture worker on 127.0.0.1:8788, in-memory D1
  # In the repo: cp harness/local-d1-contract.spec.ts tests/e2e/
  npx playwright test tests/e2e/local-d1-contract.spec.ts

Verified at d842d71 (2026-10-24): 3 specs x desktop/mobile = 6 passed:
1. Full CRUD through the real handler: add 5, real 409 cap on the 6th, relabel AT cap
   (backend findings 1+7 through the UI), remove with confirm, two-step clear-all.
2. Identity isolation on real D1: owner B never sees owner A's rows.
3. Finding F2 regression: identity flip mid-flight (focus-triggered session re-check while
   a delayed list GET is in flight) — the old owner's rows never paint.

Notes:
- One earlier desktop-only flake in the CRUD spec (5-add sequence) passed on rerun; if it
  recurs, raise the visibility timeout, it is timing not contract.
- d1Persist is false: every run starts from an empty, freshly migrated database.
