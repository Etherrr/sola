import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const mapping = {
  demo: 'overview',
  'demo/assets': 'assets',
  'demo/positions': 'defi',
  'demo/risk': 'risk',
  'portfolio/assets': 'assets',
  'portfolio/positions': 'defi',
  'portfolio/risk': 'risk',
};
describe('retired sample portfolio pages', () => {
  for (const [route, dest] of Object.entries(mapping))
    it(`${route} resumes native ${dest} without fixtures`, () => {
      const s = readFileSync(`app/${route}/page.tsx`, 'utf8');
      expect(s).toContain(`to="/account/${dest}/"`);
      expect(s).not.toMatch(/Dashboard|fixture/);
      const redirects = readFileSync('public/_redirects', 'utf8');
      expect(redirects).toContain(`/${route}/ /account/${dest}/ 308`);
    });
  it('does not weaken admission or move stored addresses', () => {
    expect(readFileSync('server/frontdoor/admission.ts', 'utf8')).not.toContain("'/demo'");
    expect(readFileSync('app/portfolio/page.tsx', 'utf8')).toContain('<CombinedWallets />');
  });
});
