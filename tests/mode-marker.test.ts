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
  it('keeps the Track page honest: no input, no network call, no live claim', () => {
    const page = readFileSync('app/track/page.tsx', 'utf8');
    expect(page).not.toMatch(/<input|<form|fetch\s*\(|LIVE_/);
    expect(page).toMatch(/not switched on/);
  });
});
