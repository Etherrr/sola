import type { NextConfig } from 'next';

// v0.1.1 is an entirely static, simulated educational preview.
// The later DeFi/API phase must reconsider hosting before adding server routes.

/**
 * Dev-surface gating (front-door Phase 0, 2026-10-26): pages under app/dev/ are
 * named page.dev.tsx. Only builds with SOLA_INCLUDE_DEV_PAGES=1 (local dev and
 * the Pages PREVIEW environment) include the 'dev.tsx' page extension, so a
 * production export cannot contain any /dev/ route at all - the route does not
 * exist in the artifact rather than rendering a runtime 404.
 */
const includeDev = process.env.SOLA_INCLUDE_DEV_PAGES === '1';

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  poweredByHeader: false,
  ...(includeDev ? { pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'dev.tsx'] } : {}),
};

export default config;
