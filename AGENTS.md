# Agent Operating Rules — Sola

**Read [README.md](README.md), [SPEC.md](SPEC.md), and your scope document before editing.** This repository documents both teams; it does not grant either agent access to the other's production systems.

## Shared non-negotiables
1. Preserve Sola's existing WordPress public site and brand. Product scope is governed by SPEC.md.
2. Sola Lens is **observation-only**. Never add private-key/seed/passphrase collection, signing, transaction submission, token approvals, trading, deposits or custody.
3. Never claim features, data, firm credentials, regulatory approvals, investor assets or historical publication dates that are not verified.
4. No secrets, live wallet data, third-party tokens or private information in Git, logs, screenshots, fixtures or PRs.
5. Use small, scoped changes. For each change: update relevant docs, tests where applicable, and [CHANGELOG.md](CHANGELOG.md).
6. No production deployment, DNS change, WordPress launch-flag activation or wallet-provider integration without explicit owner approval.
7. Prefer established, maintained libraries and minimal dependencies; disclose third-party costs/licensing and privacy effects before adoption.
8. Report verified results separately from assumptions and untested work.

## Web-app / GitHub agent
Owner: Next.js Sola Lens only. Read [docs/APP_SCOPE.md](docs/APP_SCOPE.md).
- Implement in phases (preview → watch-only → optional connectors → reviewed launch), not in one giant PR.
- Use TypeScript, schemas at external boundaries, server-side secrets, provider adapters, deterministic fixtures, and automated checks.
- No database or user accounts for v0.1 unless justified and approved.
- Keep mock/simulated values visibly separate from live data. Do not invent provider capabilities.
- Test financial precision, duplicated holdings, price gaps, provider errors, and forbidden signing surfaces.

## WordPress agent
Owner: existing public website only. Read [docs/WORDPRESS_SCOPE.md](docs/WORDPRESS_SCOPE.md).
- Preserve current V2.3→V3.0 site roadmap and public research content.
- Maintain Sola Lens project page as **In Development** until app production signoff.
- Maintain one configurable app URL and separate boolean launch flag (default off).
- Do not iframe the web app or share WordPress authentication/session cookies with it.
- Do not install wallet JS, address forms or position analytics on WordPress.

## Consistent execution loop
**Inspect → write small plan → implement on a branch → verify → document → PR/review → deploy after approval.**
Every handoff must state: changes, tests actually run, results, open risks, external dependencies, rollback impact and next work item. Follow [docs/OPERATIONS.md](docs/OPERATIONS.md).
