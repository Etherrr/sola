import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_NEXT } from '../features/auth-v2/next-path';
const read = (p: string) => readFileSync(p, 'utf8');
describe('native portfolio journey production mounts', () => {
  it('mounts the actual recorded views, never demo components', () => {
    for (const [p, component] of [['overview', 'OverviewView'], ['assets', 'AssetsView'], ['defi', 'DefiView'], ['risk', 'RiskView']]) {
      const s = read(`app/account/${p}/page.tsx`);
      expect(s).toContain(`<${component}`);
      expect(s).not.toMatch(/Dashboard|fixture|\/demo|\/dev/);
    }
    expect(DEFAULT_NEXT).toBe('/account/overview');
  });
  it('keeps legacy routes and migration page unchanged while new views use native guards', () => {
    expect(read('components/app-shell.tsx')).not.toContain("Legacy Track list");
    expect(read('features/auth-v2/account-gate.tsx')).toContain('<ClaimSection');
    expect(read('public/_routes.json')).toContain('/*');
  });
  it('entry is intentional, reduced-motion aware and points at the real overview', () => {
    const s=read('components/entrance.tsx');
    expect(s).toContain('Choose where to begin, or sign in.');
    expect(s).toContain('href="/account/overview"');
    expect(s).toContain('Skip intro');
    expect(s).toContain("prefers-reduced-motion: reduce");
    expect(s).not.toContain('setIntro(true)');
    expect(s).not.toContain('still a clearly labeled sample');
  });
});
