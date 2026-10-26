import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { lessons } from '../content/lessons';

/**
 * Permanent regression pin for the plan §8 learning-library grouping (E2) and the
 * E3 destination consolidation. Source-text assertions follow the copy-claims style:
 * they pin the reviewed structure so a later edit cannot silently reorder sections,
 * drop the simulated label on practice, or reintroduce a second education destination.
 */
describe('learning library section grouping (plan §8)', () => {
  const library = readFileSync('features/onboarding/learning-library.tsx', 'utf8');

  it('pins the five plan sections in their fixed order', () => {
    const order = [
      "'Start Here'",
      "'Fundamentals'",
      "'Wallets & Networks'",
      "'DeFi Strategies'",
      "'Risk & Security'",
    ];
    const sectionBlock = library.slice(library.indexOf('SECTION_ORDER'));
    let last = -1;
    for (const name of order) {
      const at = sectionBlock.indexOf(name);
      expect(at, `section ${name} present in SECTION_ORDER`).toBeGreaterThan(-1);
      expect(at, `section ${name} keeps its fixed order`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('every registered lesson belongs to one of the five sections', () => {
    const valid = new Set([
      'Start Here',
      'Fundamentals',
      'Wallets & Networks',
      'DeFi Strategies',
      'Risk & Security',
    ]);
    for (const lesson of lessons) expect(valid.has(lesson.section), lesson.id).toBe(true);
  });

  it('practice exercises render after the sections and stay labeled SIMULATED', () => {
    const lastSection = library.lastIndexOf('SECTION_ORDER.map');
    const practice = library.indexOf('sec-practice');
    expect(practice).toBeGreaterThan(-1);
    expect(practice, 'practice section renders after the section groups').toBeGreaterThan(
      lastSection,
    );
    const practiceBlock = library.slice(practice);
    // Both practice cards keep the honest simulated label.
    expect((practiceBlock.match(/INTERACTIVE · SIMULATED/g) || []).length).toBe(2);
  });

  it('the library return action leads back to the portfolio account page', () => {
    expect(library).toContain('href="/account"');
  });
});
