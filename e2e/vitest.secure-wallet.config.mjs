import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['e2e/wallet-secure.spec.ts'], testTimeout: 30000, hookTimeout: 60000 },
});
