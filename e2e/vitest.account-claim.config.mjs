import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['e2e/claim-account-gate.spec.ts'],
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
