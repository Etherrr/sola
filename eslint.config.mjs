import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'output/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
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
