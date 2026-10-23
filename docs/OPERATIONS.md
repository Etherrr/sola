# Simple Operating Procedure

## Roles and source of truth
- Product owner approves scope and launch.
- Web-app agent owns Sola Lens code and app tests.
- WordPress agent owns public website and launch-link integration.
- **SPEC.md** defines product boundaries; **AGENTS.md** governs behavior; role-specific scopes govern tasks; **CHANGELOG.md** records material changes. Do not create parallel conflicting master specs.

## For each change
1. Inspect relevant source/docs and current state; state assumptions.
2. Open a single scoped issue or task with owner, scope, acceptance checks and affected surface.
3. Work on a named Git branch; one coherent change per pull request.
4. Run and report available checks. Before code exists, perform docs link/content review; after scaffold, run lint, typecheck, unit tests, build and appropriate browser checks.
5. Update related docs and add a dated **Unreleased** changelog item for material changes.
6. PR review by owner or designated reviewer; merge only when accepted.
7. Deploy preview first; production only with explicit signoff. Verify after release and retain rollback path.

## Environments
- Development: local agent workspace.
- Preview: isolated, non-public or access-controlled testing; simulated fixtures clearly marked.
- Production: app subdomain only after privacy/security/provider QA.
- WordPress staging: test WordPress integration without touching live content.

## Release gates
1. Product functions and claims reviewed.
2. Tests and financial data reconciliation pass.
3. Secrets, dependency security, privacy, legal and wallet read-only checks pass.
4. App is served over HTTPS, health checks and errors monitored, cost caps/alerts enabled.
5. DNS and WordPress link approved; WordPress launch flag starts off and is the last switch.
6. Release notes, owner approval, rollback method and post-launch smoke test recorded.

## Incident / rollback
- If portfolio results misrepresent value, mark data unavailable or disable live data source immediately; never substitute fabricated balances.
- If app fails, roll back hosting deployment; disable WordPress launch flag if necessary.
- If suspicious connector/secret behavior occurs, disable impacted feature, rotate exposed credentials, review logs and notify appropriate parties.
- Log incident date, impact, response, recovery and preventive fix without exposing wallet/user secrets.

## Operational hygiene
- Avoid long-lived provider secrets in frontend.
- Keep dependencies small and pinned via lockfile after scaffold.
- Maintain verified official protocol-link list.
- Date content reviews and distinguish publication date from historical subject matter.
- No invented completion claims. All agent handoffs state completed work, verification and open issues.
