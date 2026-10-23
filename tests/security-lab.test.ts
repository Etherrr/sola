import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SCENARIOS, SOURCES } from '../features/education/security-lab-data';
describe('security decision lab', () => {
  it('has four scenarios with unique ids and at least one safer choice each', () => {
    expect(SCENARIOS).toHaveLength(4);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(4);
    for (const s of SCENARIOS) {
      expect(s.choices.length).toBeGreaterThanOrEqual(3);
      expect(new Set(s.choices.map((c) => c.id)).size).toBe(s.choices.length);
      expect(s.choices.some((c) => c.verdict === 'safer')).toBe(true);
      expect(s.choices.some((c) => c.verdict === 'risky')).toBe(true);
      for (const c of s.choices) expect(c.outcome.length).toBeGreaterThan(40);
      expect(s.saferAction.length).toBeGreaterThan(30);
    }
  });
  it('uses absolute-free, network-aware wording and cites sources', () => {
    const all = JSON.stringify(SCENARIOS);
    expect(all).not.toMatch(/\bimpossible\b|100% safe|guaranteed|completely safe/i);
    expect(SOURCES.length).toBeGreaterThanOrEqual(2);
    for (const s of SOURCES) expect(s.href).toMatch(/^https:\/\/ethereum\.org\//);
  });
  it('never asks for a secret, touches a wallet, the network or storage', () => {
    for (const f of [
      'features/education/security-lab.tsx',
      'features/education/security-lab-data.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(
        /window\.ethereum|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|indexedDB/,
      );
    }
    const ui = readFileSync('features/education/security-lab.tsx', 'utf8');
    expect(ui).not.toMatch(
      /type=["'](text|password|email|search|tel|url|number)["']|<textarea|<input(?![^>]*type="radio")/,
    );
  });
});
