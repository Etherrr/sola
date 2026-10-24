import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODES } from '../components/mode-marker';
describe('mode markers', () => {
  it('defines the five required modes with unique text labels and plain-language meaning', () => {
    expect(Object.keys(MODES)).toEqual([
      'SIMULATED',
      'LIVE_CACHED',
      'LIVE_REFRESHED',
      'STALE',
      'INCOMPLETE',
    ]);
    const labels = Object.values(MODES).map((m) => m.label);
    expect(new Set(labels).size).toBe(5);
    for (const m of Object.values(MODES)) expect(m.text.length).toBeGreaterThan(20);
  });
  it('keeps the Track flow honest: simulated labels, no live claim, no direct provider call', () => {
    const page = readFileSync('app/track/page.tsx', 'utf8');
    const form = readFileSync('features/portfolio/track-form.tsx', 'utf8');
    const client = readFileSync('features/portfolio/api-client.ts', 'utf8');
    const intro = readFileSync('features/portfolio/track-intro.tsx', 'utf8');
    expect(page).not.toMatch(/fetch\s*\(|LIVE_/);
    expect(intro).not.toMatch(/fetch\s*\(/);
    expect(intro).toMatch(/simulated/i);
    expect(intro).toMatch(/Live data stays off/);
    // The live label exists only in the branch reached when the server reports mode 'live'.
    expect(intro).toMatch(/mode === 'live'/);
    expect(form).not.toMatch(/fetch\s*\(|localStorage|sessionStorage|document\.cookie/);
    expect(form).toMatch(
      /not a blockchain|not read from a blockchain|Nothing was read from a blockchain/,
    );
    expect(client).not.toMatch(/https?:\/\//); // same-origin only, no provider URL
  });
});
