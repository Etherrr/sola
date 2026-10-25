import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * LOCAL NATIVE CONTRACT E2E — real UI against the REAL v0.2-native production handlers
 * (addresses, snapshot consent, sync, overview) running on a local workerd D1 binding with
 * migrations 0002 + 0003 applied for real. The browser talks to the real static export;
 * only the portfolio API routes are proxied to the fixture worker, which injects the
 * session cookie the same way a browser would. Every request passes the unchanged
 * requireEntitledSession gate; no auth code is weakened. Synthetic identities and mock
 * chain providers only; no production system, provider, or user data is touched. This is
 * sandbox coverage, NOT the native acceptance run (which needs the real email round-trip).
 */
const FIXTURE = 'http://127.0.0.1:8789';
let session = '';
const ETH = (c: string) => `0x${c.repeat(40)}`;

async function fixtureUp(): Promise<boolean> {
  try {
    // Unique email per probe: 0002 enforces identifier uniqueness, so a repeat probe
    // email would violate the constraint (correctly) and look like a dead worker.
    const probe = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    return (await fetch(`${FIXTURE}/fixture/seed-native?email=${probe}`)).ok;
  } catch {
    return false;
  }
}

test.beforeEach(async () => {
  const up = await fixtureUp();
  if (!up) console.log('[native-contract] fixture probe failed for:', test.info().title);
  test.skip(!up, 'native fixture worker not running: start harness/serve-native.mjs');
});

// 0002 enforces (kind, identifier) uniqueness - correct production behavior - so each
// Playwright invocation needs fresh seed identities (desktop and mobile projects share one
// in-memory D1). Plus-addressing keeps the seeded identity/entitlement pair consistent.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function seed(email: string): Promise<string> {
  const unique = email.replace('@', `+${RUN}@`);
  const r = await fetch(`${FIXTURE}/fixture/seed-native?email=${encodeURIComponent(unique)}`);
  return (await r.json()).session as string;
}

const cookieHeader = () => ({ cookie: `__Host-sola_session=${session}` });

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${FIXTURE}${path}`, {
    ...init,
    headers: { ...cookieHeader(), 'content-type': 'application/json', origin: FIXTURE, ...(init?.headers ?? {}) },
  });
}

async function proxy(page: Page, email: string) {
  const forward = async (route: Route, path: string) => {
    const req = route.request();
    const headers = {
      ...req.headers(),
      ...cookieHeader(),
      // The proxy plays the edge: present the fixture worker's own origin so the
      // handler's same-origin check sees the deployment it actually runs on.
      origin: FIXTURE,
      referer: `${FIXTURE}/dev/overview-v2`,
    };
    const resp = await route.fetch({
      url: `${FIXTURE}${path}`,
      method: req.method(),
      headers,
      postData: req.postData() ?? undefined,
    });
    await route.fulfill({ response: resp });
  };
  // Most specific first in effect: Playwright matches routes in reverse registration
  // order, so rename/remove registered after the generic addresses glob win.
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    const p = new URL(r.request().url()).pathname;
    return forward(r, p);
  });
  await page.route('**/api/v1/portfolio/snapshots/consent**', (r) =>
    forward(r, '/api/v1/portfolio/snapshots/consent'),
  );
  await page.route('**/api/v1/portfolio/sync**', (r) => forward(r, '/api/v1/portfolio/sync'));
  await page.route('**/api/v1/portfolio/overview**', (r) => forward(r, '/api/v1/portfolio/overview'));
  // The shell's own session probe reflects the seeded identity; the REAL session check
  // still happens inside the worker handlers via the injected cookie.
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email, fresh: true }),
    }),
  );
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'off' }) }),
  );
  await page.route('**/api/v1/health', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', mode: 'mock', requestId: 'r' }) }),
  );
}

async function addAddress(page: Page, address: string, label: string) {
  const main = page.locator('#main');
  await main.getByLabel('Address', { exact: true }).fill(address);
  await main.getByLabel('Label').fill(label);
  await main.getByRole('button', { name: 'Add address' }).click();
  await expect(main.getByRole('button', { name: new RegExp(`Details for ${label}`) })).toBeVisible();
}

test('native address book: CRUD through real handlers and real D1, cap + isolation enforced', async ({
  page,
}) => {
  session = await seed('owner-a@example.com');
  await proxy(page, 'owner-a@example.com');
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(main.getByText('No addresses yet - add one to watch its balances.')).toBeVisible();

  for (let i = 1; i <= 5; i++) await addAddress(page, ETH(String(i)), `Wallet ${i}`);

  // Real D1 state, read back through the real list handler:
  const list = await (await api('/api/v1/portfolio/addresses')).json();
  expect(list.addresses).toHaveLength(5);

  // The 6th add on the same network hits the real 0002-enforced cap (409 too_many_addresses).
  const sixth = await api('/api/v1/portfolio/addresses', {
    method: 'POST',
    body: JSON.stringify({ network: 'ethereum', address: ETH('6'), label: 'Wallet 6' }),
  });
  expect(sixth.status).toBe(409);
  expect((await sixth.json()).error).toBe('too_many_addresses');

  // Rename persists through the real handler (UI uses window.prompt).
  page.once('dialog', (d) => void d.accept('Renamed One'));
  await main.getByRole('button', { name: /Rename Wallet 1/ }).click();
  await expect(main.getByRole('button', { name: /Details for Renamed One/ })).toBeVisible();

  // Remove persists through the real handler (UI uses window.confirm).
  page.once('dialog', (d) => void d.accept());
  await main.getByRole('button', { name: /Remove Wallet 2/ }).click();
  await expect(main.getByRole('button', { name: /Details for Wallet 2/ })).toHaveCount(0);

  // Reload: the remaining four rows come back from real D1, not from any client cache.
  await page.reload();
  for (const label of ['Renamed One', 'Wallet 3', 'Wallet 4', 'Wallet 5'])
    await expect(main.getByRole('button', { name: new RegExp(`Details for ${label}`) })).toBeVisible();
  expect((await (await api('/api/v1/portfolio/addresses')).json()).addresses).toHaveLength(4);

  // A second seeded identity never sees the first identity's rows (0002 user isolation).
  session = await seed('owner-b@example.com');
  await page.reload();
  await expect(main.getByText('No addresses yet - add one to watch its balances.')).toBeVisible();
  expect((await (await api('/api/v1/portfolio/addresses')).json()).addresses).toHaveLength(0);
});

test('native consent → sync records into real D1 → reads reflect it → withdrawal deletes everything', async ({
  page,
}) => {
  session = await seed('owner-c@example.com');
  await proxy(page, 'owner-c@example.com');
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await addAddress(page, ETH('a'), 'Observed');

  // Consent starts off; the real status handler says so.
  expect((await (await api('/api/v1/portfolio/snapshots/consent')).json()).consented).toBe(false);
  await main.getByRole('button', { name: 'Turn on recording' }).click();
  await expect(main.getByText(/recording on/)).toBeVisible();
  expect((await (await api('/api/v1/portfolio/snapshots/consent')).json()).consented).toBe(true);

  // Refresh records a real observation row into D1 through the real sync handler.
  await main.getByRole('button', { name: 'Refresh' }).click();
  await expect(main.locator('p[role="alert"]')).toContainText(/Recorded\./, { timeout: 15000 });
  const overview = await (await api('/api/v1/portfolio/overview')).json();
  expect(overview.status).toBe('ok');
  expect(overview.latest.length).toBeGreaterThan(0);
  // The recorded row carries the recordable fixture's exact value - handler semantics,
  // not a shape check.
  expect(
    overview.latest.some((r: { assetId?: string; amount?: string }) => r.assetId === 'eip155:1/native' && r.amount === '1.25'),
  ).toBe(true);

  // The UI's expanded row reads that recorded observation back through the real overview route.
  await main.getByRole('button', { name: /Details for Observed/ }).click();
  const region = main.locator('.ab-details');
  await expect(region).toContainText('Latest complete observation');
  await expect(region).toContainText('ETH');
  await expect(region).toContainText('1.25');

  // Withdrawal deletes the recorded history for real, and every reader agrees.
  page.once('dialog', (d) => void d.accept());
  await main.getByRole('button', { name: 'Stop & delete history' }).click();
  await expect(main.getByText(/Balance history: off\./)).toBeVisible();
  expect((await (await api('/api/v1/portfolio/overview')).json()).status).toBe('empty');
  await main.getByRole('button', { name: /Details for Observed/ }).click();
  await expect(main.locator('.ab-details')).toContainText('No recorded observations yet');
});

test('native session required: no valid cookie means 401 and an honest signed-out UI', async ({
  page,
}) => {
  session = 'not-a-real-session';
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'off' }) }),
  );
  await page.route('**/api/v1/portfolio/addresses**', async (route) => {
    const resp = await route.fetch({
      url: `${FIXTURE}/api/v1/portfolio/addresses`,
      headers: { ...route.request().headers(), cookie: '__Host-sola_session=not-a-real-session' },
    });
    await route.fulfill({ response: resp });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  // One honest gate for the whole page (not four per-section "Sign in to..." lines).
  await expect(
    main.getByText('Sign in to see your holdings, addresses and recorded history.'),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/dev/sign-in');
  // The data route itself still refuses the bogus session with a real 401.
  const res = await api('/api/v1/portfolio/addresses');
  expect(res.status).toBe(401);
});

test('simulated reads are never recorded: the production guard refuses them even with consent granted', async () => {
  session = await seed('owner-guard@example.com');
  const add = await api('/api/v1/portfolio/addresses', {
    method: 'POST',
    body: JSON.stringify({ network: 'ethereum', address: ETH('a'), label: 'Guard' }),
  });
  expect(add.ok).toBe(true);
  const consent = await api('/api/v1/portfolio/snapshots/consent', {
    method: 'POST',
    body: JSON.stringify({ action: 'grant' }),
  });
  expect(consent.ok).toBe(true);
  // The harness seam selects the genuinely simulated providers; the UNCHANGED production
  // sync handler must refuse to persist their reads (server/portfolio/sync.ts).
  const sync = await fetch(`${FIXTURE}/api/v1/portfolio/sync`, {
    method: 'POST',
    headers: { ...cookieHeader(), 'content-type': 'application/json', origin: FIXTURE, 'x-fixture-provider': 'simulated' },
    body: '{}',
  });
  const body = await sync.json();
  expect(body.recorded).toBe(false);
  expect(JSON.stringify(body)).toContain('simulated_refused');
  // Nothing reached storage: the overview read agrees.
  expect((await (await api('/api/v1/portfolio/overview')).json()).status).toBe('empty');
});
