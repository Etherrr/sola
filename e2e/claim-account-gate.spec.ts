/**
 * REAL-INTEGRATION claim section tests (reviewer E1): the ACTUAL /account page
 * (static export) with the PRODUCTION seams - AccountGate, useNativeSession,
 * claimSectionLive.discover, the real api-client paths. Only the network is
 * intercepted (page.route): session, address book, and the claim endpoints are
 * mocked at the wire; every claim-area request is counted.
 *
 * Proves the integration guarantees the dev-surface tests cannot:
 *  - non-ready gate branches (signed-out, not-invited, stale session) render
 *    no section and fire ZERO claim-area requests (not even discovery);
 *  - the ready branch fires EXACTLY ONE discovery request and no other claim
 *    request before the explicit click;
 *  - claimSectionLive.discover fails closed: !ok, malformed body, and
 *    claim!==true all render no entry point;
 *  - discovery {claim:false} renders no section: the rendered UI equals
 *    today's account page, with exactly one added request (the discovery GET).
 * Requires `npm run build` first. NOT part of the default suite.
 * Run: npx vitest run --config e2e/vitest.account-claim.config.mjs
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page, type Route } from 'playwright';

let dev: ChildProcess;
let browser: Browser;

const waitFor = async (url: string, ms: number) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

beforeAll(async () => {
  dev = spawn('npm', ['start'], { cwd: process.cwd(), stdio: 'ignore' });
  await waitFor('http://127.0.0.1:3000/account/', 30000);
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  dev?.kill();
});

type ClaimCalls = { features: number; preview: number; attempt: number; report: number; rollback: number };
type Scenario = {
  session: { status: number; body?: unknown };
  addresses: { status: number; body?: unknown };
  features: { status: number; body?: unknown };
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const openAccount = async (
  s: Scenario,
  viewport = { width: 1278, height: 900 },
): Promise<{ page: Page; calls: ClaimCalls }> => {
  const calls: ClaimCalls = { features: 0, preview: 0, attempt: 0, report: 0, rollback: 0 };
  const page = await browser.newPage({ viewport });
  await page.route('**/api/v1/auth/email/session', (route) => json(route, s.session.status, s.session.body ?? { error: 'auth_required' }));
  await page.route('**/api/v1/portfolio/addresses', (route) =>
    json(route, s.addresses.status, s.addresses.body ?? { error: 'not_entitled' }),
  );
  await page.route('**/api/v1/claim/features', (route) => {
    calls.features++;
    return json(route, s.features.status, s.features.body ?? { claim: false });
  });
  await page.route('**/api/v1/claim/preview', (route) => {
    calls.preview++;
    return json(route, 503, { error: { code: 'disabled' } });
  });
  await page.route('**/api/v1/claim/attempt', (route) => {
    calls.attempt++;
    return json(route, 503, { error: { code: 'disabled' } });
  });
  await page.route('**/api/v1/claim/report/**', (route) => {
    calls.report++;
    return json(route, 404, { error: { code: 'unknown_attempt' } });
  });
  await page.route('**/api/v1/claim/rollback/**', (route) => {
    calls.rollback++;
    return json(route, 503, { error: { code: 'disabled' } });
  });
  await page.goto('http://127.0.0.1:3000/account/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900); // let gate effects settle
  return { page, calls };
};

const OK_SESSION = { status: 200, body: { status: 'ok', email: 'u@x.test', fresh: true } };
const HEALTHY_BOOK = {
  status: 200,
  body: {
    status: 'ok',
    addresses: [
      {
        network: 'ethereum',
        address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        label: 'Savings',
        verification: 'watched',
        createdAt: '2026-10-20T00:00:00Z',
        lastObservedAt: null,
      },
    ],
  },
};
const ZERO: ClaimCalls = { features: 0, preview: 0, attempt: 0, report: 0, rollback: 0 };

describe('real /account integration (production seams, mocked wire)', () => {
  it('signed-out: redirects to sign-in, ZERO claim-area requests', async () => {
    const { page, calls } = await openAccount({
      session: { status: 401 },
      addresses: { status: 401 },
      features: { status: 200, body: { claim: true } },
    });
    await page.waitForURL('**/sign-in/**', { timeout: 10000 });
    expect(calls).toEqual(ZERO);
    await page.close();
  });

  it('not-invited: honest not-invited state, ZERO claim-area requests', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: { status: 403, body: { error: 'not_entitled' } },
      features: { status: 200, body: { claim: true } },
    });
    await page.waitForSelector('text=Not invited yet');
    expect(calls).toEqual(ZERO);
    expect(await page.getByRole('button', { name: 'Check for saved addresses' }).count()).toBe(0);
    await page.close();
  });

  it('stale session (data route 401): reauth state, ZERO claim-area requests', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: { status: 401, body: { error: 'auth_required' } },
      features: { status: 200, body: { claim: true } },
    });
    await page.waitForSelector('text=This session went stale.');
    expect(calls).toEqual(ZERO);
    await page.close();
  });

  it('ready + claim:true: EXACTLY ONE discovery request, nothing else until the explicit click', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: HEALTHY_BOOK,
      features: { status: 200, body: { claim: true } },
    });
    await page.waitForSelector('text=Check for saved addresses');
    expect(calls).toEqual({ ...ZERO, features: 1 });
    expect(await page.locator('.claim-panel').count()).toBe(0);
    await page.getByRole('button', { name: 'Check for saved addresses' }).click();
    // The panel mounts and its first (and only) automatic call is the preview;
    // the mocked 503 disabled answer renders the honest could-not-check state.
    await page.waitForSelector('text=Could not check your old saved addresses.');
    expect(calls).toEqual({ ...ZERO, features: 1, preview: 1 });
    await page.close();
  });

  it('ready + claim:false: no section, exactly one added request (rendered UI unchanged)', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: HEALTHY_BOOK,
      features: { status: 200, body: { claim: false } },
    });
    await page.waitForSelector('text=Signed in as u@x.test.');
    await page.waitForTimeout(900);
    expect(await page.locator('.claim-section').count()).toBe(0);
    expect(calls).toEqual({ ...ZERO, features: 1 });
    await page.close();
  });

  it('ready + discovery 500: fail closed, no entry point, no further claim requests', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: HEALTHY_BOOK,
      features: { status: 500, body: { error: 'unavailable' } },
    });
    await page.waitForSelector('text=Signed in as u@x.test.');
    await page.waitForTimeout(900);
    expect(await page.getByRole('button', { name: 'Check for saved addresses' }).count()).toBe(0);
    expect(calls).toEqual({ ...ZERO, features: 1 });
    await page.close();
  });

  it('ready + malformed discovery body (200 {}): fail closed, no entry point', async () => {
    const { page, calls } = await openAccount({
      session: OK_SESSION,
      addresses: HEALTHY_BOOK,
      features: { status: 200, body: {} },
    });
    await page.waitForSelector('text=Signed in as u@x.test.');
    await page.waitForTimeout(900);
    expect(await page.getByRole('button', { name: 'Check for saved addresses' }).count()).toBe(0);
    expect(calls).toEqual({ ...ZERO, features: 1 });
    await page.close();
  });

  it('gate loading branch: while session is unresolved, no section and ZERO claim-area requests', async () => {
    const calls: ClaimCalls = { features: 0, preview: 0, attempt: 0, report: 0, rollback: 0 };
    const page = await browser.newPage({ viewport: { width: 1278, height: 900 } });
    await page.route('**/api/v1/auth/email/session', async (route) => {
      await new Promise((r) => setTimeout(r, 4000)); // session still resolving
      return json(route, 200, OK_SESSION.body);
    });
    await page.route('**/api/v1/portfolio/addresses', (route) => json(route, 200, HEALTHY_BOOK.body));
    await page.route('**/api/v1/claim/**', (route) => {
      calls.features++;
      return json(route, 200, { claim: true });
    });
    await page.goto('http://127.0.0.1:3000/account/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Checking your sign-in');
    await page.waitForTimeout(1500); // still loading; discovery must NOT have fired
    expect(calls).toEqual(ZERO);
    expect(await page.locator('.claim-section').count()).toBe(0);
    await page.close();
  });

  it('strict claim===true: truthy non-true answers (1, "true") render no entry point', async () => {
    for (const body of [{ claim: 1 }, { claim: 'true' }]) {
      const { page, calls } = await openAccount({
        session: OK_SESSION,
        addresses: HEALTHY_BOOK,
        features: { status: 200, body },
      });
      await page.waitForSelector('text=Signed in as u@x.test.');
      await page.waitForTimeout(900);
      expect(await page.getByRole('button', { name: 'Check for saved addresses' }).count()).toBe(0);
      expect(calls).toEqual({ ...ZERO, features: 1 });
      await page.close();
    }
  });

  it('unparseable discovery body (200, invalid JSON): fail closed, no entry point', async () => {
    const calls: ClaimCalls = { features: 0, preview: 0, attempt: 0, report: 0, rollback: 0 };
    const page = await browser.newPage({ viewport: { width: 1278, height: 900 } });
    await page.route('**/api/v1/auth/email/session', (route) => json(route, 200, OK_SESSION.body));
    await page.route('**/api/v1/portfolio/addresses', (route) => json(route, 200, HEALTHY_BOOK.body));
    // Catch-all FIRST: Playwright matches most-recently-added routes first,
    // and **/api/v1/claim/** also matches /claim/features.
    await page.route('**/api/v1/claim/**', (route) => {
      calls.preview++;
      return json(route, 503, { error: { code: 'disabled' } });
    });
    await page.route('**/api/v1/claim/features', (route) => {
      calls.features++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'this is not json{{' });
    });
    await page.goto('http://127.0.0.1:3000/account/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Signed in as u@x.test.');
    await page.waitForTimeout(900);
    expect(await page.getByRole('button', { name: 'Check for saved addresses' }).count()).toBe(0);
    expect(calls).toEqual({ ...ZERO, features: 1 });
    await page.close();
  });
});
