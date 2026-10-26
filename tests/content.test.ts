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
  it('keeps transaction operations forbidden and message signing confined to reviewed wallet paths', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    }
    // The single approved network call is a same-origin POST to our own read-only API.
    const API_CLIENT = join('features', 'portfolio', 'api-client.ts');
    const paths = ['app', 'components', 'features', 'lib']
      .flatMap(files)
      .filter((file) => /\.(ts|tsx)$/.test(file) && file !== API_CLIENT);
    const source = paths.map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    // Exactly eighteen fetch call sites exist: the single-address lookup POST and its multi-address
    // variant (same resolve endpoint, same transport guarantees), the same-origin session GET,
    // the same-origin health GET, the same-origin saved-addresses API, the same-origin
    // markets overview GET, the v0.2 own-history overview GET, the two native email
    // sign-in POSTs (challenge + verify), the three native address-book requests
    // (list/add, rename, remove), the two native session requests
    // (info GET + logout POST), and ONE shared fetch inside passkeyRequest that the four
    // passkey requests (register options/verify, login options/verify) all funnel
    // through, and ONE shared fetch inside portfolioActionRequest that the three
    // observation requests (consent status, consent change, sync) funnel through -
    // all through this one module. Seventeenth: ONE shared fetch inside claimRequest
    // that the four claim requests (preview/attempt/report/rollback, plan B.3) funnel
    // through; the endpoints 503 while CLAIM_ENABLED ships absent. Eighteenth:
    // the claim FEATURE DISCOVERY GET - the only claim-area request /account may
    // make before user initiation; a false/failed answer means no claim endpoint
    // is ever called. Nineteenth: ONE shared fetch inside portfolioViewRequest
    // that the FOUR recorded view requests (assets, positions, risk, and the
    // plan 6.1 Overview page wire at /api/v1/portfolio/summary - note the
    // What-changed route /api/v1/portfolio/overview is a DIFFERENT endpoint;
    // tests/portfolio-route-contracts.test.ts pins both contracts) funnel
    // through; each is a reviewed GET read route.
    expect(readFileSync(API_CLIENT, 'utf8').match(/fetch\s*\(/g)).toHaveLength(19);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/claim\/features'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/health'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/session'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/portfolio\/resolve'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/fetch\('\/api\/v1\/portfolio\/accounts'/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/markets\/overview/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/overview/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/email\/challenge/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/email\/verify/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/addresses/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/addresses\/rename/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/addresses\/remove/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/email\/session/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/email\/logout/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/passkey\/register\/options/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/passkey\/register\/verify/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/passkey\/login\/options/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/auth\/passkey\/login\/verify/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/snapshots\/consent/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/sync/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/assets/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/positions/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/risk/);
    expect(readFileSync(API_CLIENT, 'utf8')).toMatch(/\/api\/v1\/portfolio\/summary/);
    // Transaction, approval and arbitrary network operations remain forbidden everywhere.
    expect(source).not.toMatch(/window\.(ethereum|solana)|signTransaction|signAllTransactions|sendTransaction|eth_sendTransaction|eth_signTypedData|wallet_sendCalls|fetch\s*\(/);
    const approvedMessagePaths = new Set(['features/auth-v2/wallet-connectors.ts','features/auth-v2/wallet-flow.ts']);
    for (const path of paths.filter(path => !approvedMessagePaths.has(path)))
      expect(readFileSync(path,'utf8')).not.toMatch(/eth_requestAccounts|method:\s*'personal_sign'|signMessage\s*\(/);
    const connector = readFileSync('features/auth-v2/wallet-connectors.ts','utf8');
    expect(connector.match(/method:'personal_sign'/g)).toHaveLength(1);
    expect(connector.match(/await signer\.signMessage\(/g)).toHaveLength(1);
    expect(connector).not.toMatch(/method:'eth_sign'|method:'eth_signTypedData/);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    // jose (MIT, no dependencies, exact-pinned) verifies Access JWTs on the server only.
    // @noble/curves + @noble/hashes (exact-pinned) verify SIWE/SIWS SIGN-IN signatures
    // in server/auth only - message-signature verification, NEVER transaction or
    // approval signing, and never imported by application code.
    // @simplewebauthn/server (exact-pinned, WebCrypto-based) verifies passkey
    // ceremonies in server/auth only; never imported by application code.
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@noble/curves', '@noble/hashes', '@simplewebauthn/server', '@solana/wallet-standard-features', '@wallet-standard/app', '@wallet-standard/features', 'jose', 'mipd', 'next', 'react', 'react-dom']);
    for(const dependency of ['mipd','@wallet-standard/app','@wallet-standard/features','@solana/wallet-standard-features']) expect(pkg.dependencies[dependency]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@simplewebauthn/server']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies.jose).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@noble/curves']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@noble/hashes']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(source).not.toMatch(/@noble\//);
    expect(source).not.toMatch(/@simplewebauthn/);
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
