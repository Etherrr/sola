import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['e2e/wallet-customer.spec.ts'], testTimeout: 60000, hookTimeout: 60000 },
});
