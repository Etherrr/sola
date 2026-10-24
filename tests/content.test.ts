import { describe, expect, it } from 'vitest';
import { lessons } from '../content/lessons';
import { parseProgress } from '../lib/progress';
import { officialLinks } from '../lib/official-links';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
describe('learning and safety boundaries', () => {
  it('has six complete educational modules with valid quiz answers', () => {
    expect(lessons).toHaveLength(6);
    for (const lesson of lessons) {
      expect(lesson.sections.length).toBeGreaterThanOrEqual(3);
      expect(lesson.answers[lesson.correct]).toBeTruthy();
      expect(lesson.explanation.length).toBeGreaterThan(30);
    }
  });
  it('validates and deduplicates untrusted local progress', () => {
    expect(parseProgress(null)).toEqual([]);
    expect(parseProgress('{broken')).toEqual([]);
    expect(parseProgress('{}')).toEqual([]);
    expect(parseProgress('["security","security","unknown",1,null]')).toEqual(['security']);
  });
  it('links only to the reviewed official HTTPS allowlist', () => {
    expect(officialLinks.map((link) => new URL(link.url).hostname)).toEqual([
      'metamask.io',
      'nu.fi',
      'onekey.so',
      'www.ledger.com',
      'jup.ag',
      'ethereum.org',
    ]);
    expect(officialLinks.every((link) => link.url.startsWith('https://'))).toBe(true);
  });
  it('keeps wallet libraries and signing/lookup operations out of application code', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    }
    // The single approved network call is a same-origin POST to our own read-only API.
    const API_CLIENT = join('features', 'portfolio', 'api-client.ts');
    const source = ['app', 'components', 'features', 'lib']
      .flatMap(files)
      .filter((file) => /\.(ts|tsx)$/.test(file) && file !== API_CLIENT)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    // Exactly two browser requests exist: the lookup POST and the same-origin session GET.
    expect(readFileSync(API_CLIENT, 'utf8').match(/fetch\s*\(/g)).toHaveLength(2);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/session'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/portfolio\/resolve'/);
    expect(source).not.toMatch(
      /window\.(ethereum|solana)|eth_requestAccounts|signTransaction|signMessage|sendTransaction|fetch\s*\(/,
    );
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    // jose (MIT, no dependencies, exact-pinned) verifies Access JWTs on the server only.
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['jose', 'next', 'react', 'react-dom']);
    expect(pkg.dependencies.jose).toMatch(/^\d+\.\d+\.\d+$/);
    expect(source).not.toMatch(/from 'jose'/);
  });
  it('keeps server-only API code out of the browser bundle directories', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    }
    const source = ['app', 'components', 'features', 'lib']
      .flatMap(files)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/from\s+['"][^'"]*(server\/|functions\/)/);
  });
});
