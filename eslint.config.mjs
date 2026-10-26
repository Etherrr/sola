import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'node_modules/**',
    'output/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    // Generated esbuild bundles, never source (regenerated per run, gitignored).
    'harness/fixture-worker.mjs',
    'harness/fixture-native-worker.mjs',
  ]),
  {
    // Sandbox harness scripts run on plain Node, not in the app/browser environment.
    files: ['harness/**/*.mjs', 'e2e/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly', process: 'readonly', URL: 'readonly',
        fetch: 'readonly', setTimeout: 'readonly',
        // Used inside page.evaluate callbacks that execute in the browser.
        window: 'readonly', document: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
]);
