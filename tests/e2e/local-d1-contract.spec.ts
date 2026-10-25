import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * LOCAL CONTRACT E2E — real UI against the REAL production handlers (handleAccounts,
 * handleSession) running on a local workerd D1 binding. The browser talks to the real
 * static export; only the two API routes under test are proxied to the fixture worker,
 * which plays Cloudflare Access's edge role (injects cf-access-jwt-assertion) inside the
 * sandbox. JWTs are genuinely verified by the unchanged production verifier. Synthetic
 * identities and addresses only; no production system, provider, or user data is touched.
 */
const FIXTURE = 'http://127.0.0.1:8788';
const ETH = (c: string) => `0x${c.repeat(40)}`;
let token = '';
let delayAccountsGetMs = 0;

// Skips cleanly when the local fixture worker (harness/serve.mjs) is not running, so the
// ordinary e2e suite stays green; with the worker up, every test in this file must pass.
async function fixtureUp(): Promise<boolean> {
  try {
    return (await fetch(`${FIXTURE}/fixture/mint?sub=probe&email=probe@example.com`)).ok;
  } catch {
    return false;
  }
}

test.beforeEach(async () => {
  test.skip(!(await fixtureUp()), 'local fixture worker not running: start harness/serve.mjs');
});

async function mint(sub: string, email: string): Promise<string> {
  const r = await fetch(`${FIXTURE}/fixture/mint?sub=${sub}&email=${email}`);
  return (await r.json()).token as string;
}

async function proxy(page: Page) {
  const forward = async (route: Route, path: string) => {
    if (delayAccountsGetMs && path.includes('accounts') && route.request().method() === 'GET')
      await new Promise((r) => setTimeout(r, delayAccountsGetMs));
    const req = route.request();
    const headers = {
      ...req.headers(),
      'cf-access-jwt-assertion': token,
      // The proxy plays the Access edge: present the fixture worker's own origin so the
      // handler's same-origin check sees the deployment it actually runs on.
      origin: FIXTURE,
      referer: `${FIXTURE}/track`,
    };
    const resp = await route.fetch({
      url: `${FIXTURE}${path}`,
      method: req.method(),
      headers,
      postData: req.postData() ?? undefined,
    });
    await route.fulfill({ response: resp });
  };
  await page.route('**/api/v1/portfolio/accounts', (r) => forward(r, '/api/v1/portfolio/accounts'));
  await page.route('**/api/v1/session', (r) => forward(r, '/api/v1/session'));
  await page.route('**/api/v1/health', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', mode: 'mock', requestId: 'r' }) }),
  );
  await page.route('**/api/v1/portfolio/resolve', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'disabled', message: 'off' }, requestId: 'r' }) }),
  );
}

test.beforeEach(async ({ page }) => {
  delayAccountsGetMs = 0;
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
});

async function addViaUi(page: Page, address: string, label: string) {
  await page.getByLabel(/Save an Ethereum address|Save a Solana address/).fill(address);
  await page.getByLabel('Label').fill(label);
  await page.getByRole('button', { name: 'Save address' }).click();
}

test('contract: full CRUD against the real handler and real D1', async ({ page }) => {
  token = await mint('user-a', 'a@example.com');
  await proxy(page);
  await page.goto('/track');
  const panel = page.locator('section.accounts');
  await expect(panel.getByText('None saved.').first()).toBeVisible();

  for (let i = 0; i < 5; i += 1) {
    await addViaUi(page, ETH(String(i + 1)), `w${i + 1}`);
    await expect(panel.getByText(`w${i + 1}`)).toBeVisible();
  }
  // 6th at the cap: real 409 from the real handler.
  await addViaUi(page, ETH('f'), 'sixth');
  await expect(panel.getByText('At most 5 saved addresses per network.')).toBeVisible();
  await expect(panel.getByText('sixth')).toHaveCount(0);

  // Relabel AT the cap (backend findings 1+7, through the real UI).
  await panel.locator('li', { hasText: 'w1' }).getByRole('button', { name: 'Rename' }).click();
  const renameRow = panel.locator('li', { has: page.getByLabel(/New label for/) });
  await renameRow.getByLabel(/New label for/).fill('cold-one');
  await renameRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('cold-one')).toBeVisible();

  // Remove with confirm; clear-all with two-step confirm.
  const row2 = panel.locator('li', { hasText: 'w2' });
  await row2.getByRole('button', { name: 'Remove', exact: true }).click();
  await row2.getByRole('button', { name: 'Remove it' }).click();
  await expect(panel.getByText('w2')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Clear all saved addresses' }).click();
  await panel.getByRole('button', { name: 'Clear everything' }).click();
  await expect(panel.getByText('None saved.').first()).toBeVisible();
});

test('contract: identity switch shows only the new owner rows (real D1 isolation)', async ({ page }) => {
  token = await mint('user-iso-a', 'iso-a@example.com');
  await proxy(page);
  await page.goto('/track');
  const panel = page.locator('section.accounts');
  await addViaUi(page, ETH('a'), 'alice-wallet');
  await expect(panel.getByText('alice-wallet')).toBeVisible();

  token = await mint('user-iso-b', 'iso-b@example.com');
  await page.reload();
  await expect(panel.getByText('None saved.').first()).toBeVisible();
  await expect(panel.getByText('alice-wallet')).toHaveCount(0);
});

test('contract: identity flip mid-flight never paints the old owner list (finding F2)', async ({ page }) => {
  token = await mint('user-f2-a', 'f2-a@example.com');
  await proxy(page);
  await page.goto('/track');
  const panel = page.locator('section.accounts');
  await addViaUi(page, ETH('c'), 'secret-a-row');
  await expect(panel.getByText('secret-a-row')).toBeVisible();

  // Identity flips while a fresh list fetch is still in flight: the completion must be dropped.
  delayAccountsGetMs = 900;
  token = await mint('user-f2-b', 'f2-b@example.com');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByText('secret-a-row')).toHaveCount(0);
  await expect(panel.getByText('None saved.').first()).toBeVisible({ timeout: 5000 });
});
