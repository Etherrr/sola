import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('copy never claims a wallet is empty when the read failed', () => {
  it.each(['server/portfolio/provider.ts', 'features/portfolio/track-form.tsx'])(
    '%s has no categorical "not an empty wallet" claim',
    (f) => {
      expect(readFileSync(f, 'utf8')).not.toMatch(/not an empty wallet/i);
    },
  );
});
