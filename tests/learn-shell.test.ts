import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { lessons } from '../content/lessons';

/**
 * Permanent regression pin for the plan §8 separate learning shell (E4-shell): /learn/*
 * renders its own navigation - the five plan sections in their pinned order, practice
 * last and labeled SIMULATED, a return-to-portfolio action - with no Portfolio sidebar,
 * no network picker and no balances or metrics chrome. Source-text assertions follow
 * the copy-claims style so a later edit cannot silently reintroduce portfolio chrome
 * into lessons or drop the separation.
 */
describe('separate learning shell (plan §8)', () => {
  const shell = readFileSync('components/learn-shell.tsx', 'utf8');
  const appShell = readFileSync('components/app-shell.tsx', 'utf8');

  it('the app shell hands every /learn/* route to the learning shell', () => {
    expect(appShell).toContain("path.startsWith('/learn')");
    expect(appShell).toContain('<LearnShell>{children}</LearnShell>');
    // The branch returns before the standard chrome's TrackNetworkProvider wrapper.
    const branch = appShell.indexOf('<LearnShell>{children}</LearnShell>');
    const standardChrome = appShell.indexOf('<TrackNetworkProvider>');
    expect(branch).toBeGreaterThan(-1);
    expect(standardChrome).toBeGreaterThan(-1);
    expect(branch, 'learning-shell branch precedes the portfolio chrome').toBeLessThan(
      standardChrome,
    );
  });

  it('the learning shell carries no portfolio or network chrome', () => {
    for (const banned of [
      'ChainSelector',
      'TrackNetworkProvider',
      'Legacy Track list',
      "'/markets'",
      "'/portfolio'",
      'fetchHealth',
      'DeFi App',
    ]) {
      expect(shell, `learning shell must not reference ${banned}`).not.toContain(banned);
    }
  });

  it('the learning shell keeps a return-to-portfolio action', () => {
    expect(shell).toContain('Back to the portfolio');
    expect(shell).toContain("href: '/account'");
  });

  it('the learning nav is built from the registry in the pinned section order', () => {
    expect(shell).toContain("from '@/content/lessons'");
    expect(shell).toContain("SECTION_ORDER");
    expect(shell).toContain('aria-label="Learning"');
    // Every registered lesson path is a /learn/* route the shell can mark current.
    for (const lesson of lessons) expect(lesson.path.startsWith('/learn/')).toBe(true);
  });

  it('practice exercises stay last and labeled SIMULATED', () => {
    const practice = shell.indexOf('Practice exercises');
    expect(practice).toBeGreaterThan(-1);
    expect(practice, 'practice group renders after the section groups').toBeGreaterThan(
      shell.indexOf('lessonLinks'),
    );
    expect((shell.match(/SIMULATED/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('the learning shell does not run the app health read', () => {
    const call = appShell.indexOf('fetchHealth()');
    const effect = appShell.slice(Math.max(0, call - 400), call);
    expect(effect).toContain("path.startsWith('/learn')");
  });

  it('the health read fires exactly once on the first non-learn render', () => {
    // Reviewer edge on fe2a3e0: a mount-only fetch skipped on an initial /learn entry
    // stayed skipped after a client-side return to the portfolio, leaving the global
    // mode unknown and the demo data hint absent. The effect is path-keyed and
    // ref-guarded so the first non-learn render fetches once and never again.
    expect(appShell).toContain('const healthFetched = useRef(false);');
    const guard = appShell.indexOf('if (healthFetched.current) return;');
    expect(guard).toBeGreaterThan(-1);
    const effect = appShell.slice(Math.max(0, guard - 400), guard + 400);
    expect(effect).toContain("path.startsWith('/learn')");
    expect(effect).toContain('healthFetched.current = true;');
    expect(effect).toContain('}, [path]);');
    // The /learn skip must run before the once-guard so lessons never trigger the fetch.
    expect(effect.indexOf("path.startsWith('/learn')")).toBeLessThan(
      effect.indexOf('if (healthFetched.current) return;'),
    );
  });
});
