import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['e2e/webauthn-ui.spec.ts'],
    testTimeout: 110000,
    hookTimeout: 110000,
  },
});
