import type { NextConfig } from 'next';

// v0.1.1 is an entirely static, simulated educational preview.
// The later DeFi/API phase must reconsider hosting before adding server routes.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  poweredByHeader: false,
};

export default config;
