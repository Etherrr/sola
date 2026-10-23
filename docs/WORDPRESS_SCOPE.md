# WordPress Agent — Site Scope & Integration Contract

The existing WordPress `solacapitalpartners.com` is the public corporate/research site. Do not replace its theme, data sources, page structure or published content wholesale. Preserve the existing approved V2.3→V3.0 website roadmap.

## Responsibilities
- Maintain existing Home, Markets, Insights, Projects, About/Timeline and Contact, including responsive header/footer and verified claims.
- Sola Lens Projects entry should accurately describe the product as a planned **read-only DeFi portfolio-intelligence and guided education portal**.
- Continue existing editorial/design/market-hub QA work independently of app engineering.
- Provide research/education links to app team when appropriate; no duplicate wallet implementation in WordPress.

## Launch link contract
- Central WordPress configuration: `sola_lens_app_url` (proposed `https://app.solacapitalpartners.com`) and `sola_lens_launch_enabled` (boolean; **false by default**).
- When **false**, show `In Development` and links to relevant project/research pages; no active `Launch App` button or false availability claims.
- When **true**, after documented approval, expose one consistently named `Sola Lens / DeFi Portal` entry in Projects and optionally primary navigation/homepage.
- Link externally by normal HTTPS navigation. Do **not** embed an iframe, load web-app wallet scripts, share WordPress credentials/sessions, or install portfolio aggregation code into WordPress.
- Verify external link target is healthy, domain/TLS valid, privacy/risk pages live, mobile branding consistent, and rollback is tested.
- Domain registration can remain at WordPress; add only the `app` DNS record requested by independent application host **after approval**. Preserve apex/www/email DNS records.

## Expected handoff to app agent
Approved logo assets and design tokens; nav/button copy; link label; contact and security disclaimers; project-page wording; agreed launch switch method.

## Acceptance checklist
- Existing site remains available with no navigation/content regressions.
- Sola Lens status remains accurate at every stage.
- Portal launch config can be activated/deactivated without editing many pages.
- No misleading live wallet/portfolio UI on WordPress.
- Link-only integration works on mobile and desktop after app launch gate.
- Changes reviewed in staging, with rollback details.

Do not assert firm registration, AUM, financial services permissions, historical article dates, risk-free investing or guaranteed returns without verification.
