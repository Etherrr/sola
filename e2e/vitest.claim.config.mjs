import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['e2e/claim-panel.spec.ts'],
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
