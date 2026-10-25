import { test, expect, type Page } from '@playwright/test';

// Synthetic fixture addresses only; the stubbed API reads no chain and no real user data.
const ETH1 = '0x' + 'a'.repeat(40);
const ETH2 = '0x' + 'b'.repeat(40);
const SOL1 = 'So1DemoAddr9' + 'z'.repeat(31);

type Row = { network: 'ethereum' | 'solana'; address: string; label: string; createdAt: string; updatedAt: string };
const mkRow = (network: Row['network'], address: string, label: string): Row => ({
  network,
  address,
  label,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
});

/** A stateful stand-in for /api/v1/portfolio/accounts enforcing the same shape and cap. */
async function stubAccounts(page: Page, seed: Row[] = []) {
  const rows = [...seed];
  await page.route('**/api/v1/portfolio/accounts', async (route) => {
    const req = route.request();
    const ok = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'r', ...(body as object) }) });
    const bad = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify({ error: { code, message }, requestId: 'r' }) });
    if (req.method() === 'GET') return ok({ accounts: rows, limits: { maxPerNetwork: 5 } });
    const body = JSON.parse(req.postData() ?? '{}') as { network?: Row['network']; address?: string; label?: string; all?: boolean };
    if (req.method() === 'DELETE') {
      if (body.all === true) {
        rows.length = 0;
        return ok({ cleared: true });
      }
      const i = rows.findIndex((r) => r.network === body.network && r.address === body.address);
      if (i >= 0) rows.splice(i, 1);
      return ok({ removed: true });
    }
    // POST
    if (!body.network || !body.address || !body.label) return bad(400, 'bad_entry', 'bad');
    const existing = rows.find((r) => r.network === body.network && r.address === body.address);
    if (existing) {
      existing.label = body.label;
      return ok({ account: existing });
    }
    if (rows.filter((r) => r.network === body.network).length >= 5)
      return bad(409, 'cap_reached', 'At most 5 saved addresses per network.');
    const row = mkRow(body.network, body.address, body.label);
    rows.push(row);
    return ok({ account: row });
  });
  return rows;
}

async function stubSession(page: Page, verified: boolean) {
  await page.route('**/api/v1/session', (r) =>
    verified
      ? r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ok',
            via: 'cloudflare-access',
            identity: { email: 'jun@example.com' },
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        })
      : r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // intro plays every load; opt out here
  await page.route('**/api/v1/health', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', mode: 'mock', requestId: 'r' }) }),
  );
  await page.route('**/api/v1/portfolio/resolve', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'disabled', message: 'off' }, requestId: 'r' }) }),
  );
});

test('verified user sees saved addresses grouped and can add, rename, remove and clear', async ({ page }, info) => {
  await stubSession(page, true);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet'), mkRow('solana', SOL1, 'Solar')]);
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByRole('heading', { name: 'Saved addresses' })).toBeVisible();
  await expect(panel.getByText('Cold wallet')).toBeVisible();
  await expect(panel.getByText('Solar')).toBeVisible();

  // Add a second ETH address.
  await page.locator('#accounts-addr').fill(ETH2);
  await page.locator('#accounts-label').fill('Hot wallet');
  await panel.getByRole('button', { name: 'Save address' }).click();
  await expect(panel.getByText('Hot wallet')).toBeVisible();
  await panel.getByText('Hot wallet').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-populated.png` });
  // The add form, focused like a keyboard user: control must sit between the sticky bars.
  await page.locator('#accounts-addr').focus();
  await page.locator('#accounts-addr').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-form.png` });

  // Rename it; the same key relabels, it does not duplicate.
  await panel.getByRole('button', { name: 'Rename' }).first().click();
  await panel.getByLabel(/New label for/).fill('Very cold');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('Very cold')).toBeVisible();
  await expect(panel.getByText('Cold wallet')).toHaveCount(0);

  // Remove one with the inline confirm.
  await panel.getByRole('button', { name: 'Remove' }).first().click();
  await panel.getByRole('button', { name: 'Remove it' }).click();
  await expect(panel.getByText('Very cold')).toHaveCount(0);
  // Focus is never dumped to <body> after a destructive action: it lands on the panel heading.
  await expect(panel.locator('h2#accounts-h')).toBeFocused();
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-post-remove-focus.png` });

  // Clear-all is a two-step confirm.
  await panel.getByRole('button', { name: 'Clear all saved addresses' }).click();
  await expect(panel.getByText('Clear every saved address?')).toBeVisible();
  await panel.getByText('Clear every saved address?').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-clear-confirm.png` });
  await panel.getByRole('button', { name: 'Clear everything' }).click();
  await expect(panel.getByText('None saved.').first()).toBeVisible();
  await expect(panel.locator('h2#accounts-h')).toBeFocused(); // same after clearing the list
  await expect(panel.getByText('Solar')).toHaveCount(0);
});

test('feature off (503 disabled) shows the default-off state and offers no controls', async ({ page }, info) => {
  await stubSession(page, true);
  await page.route('**/api/v1/portfolio/accounts', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'disabled', message: 'This feature is switched off.' }, requestId: 'r' }) }),
  );
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('Saved addresses are switched off on this deployment. Nothing is stored.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save address' })).toHaveCount(0);
  await panel.screenshot({ path: `test-results/accounts-${info.project.name}-off.png` });
});

test('rejected session shows the sign-in state and no saved data', async ({ page }, info) => {
  await stubSession(page, false);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet')]);
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('Saving addresses needs a verified sign-in.')).toBeVisible();
  await expect(panel.getByText('Cold wallet')).toHaveCount(0);
  await panel.screenshot({ path: `test-results/accounts-${info.project.name}-signin.png` });
});

test('storage failure shows a bounded retryable error', async ({ page }, info) => {
  await stubSession(page, true);
  await page.route('**/api/v1/portfolio/accounts', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable', message: 'x' }, requestId: 'r' }) }),
  );
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('Account storage is unavailable. Try again later.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
  await panel.screenshot({ path: `test-results/accounts-${info.project.name}-storage.png` });
});

test('cap and rate-limit surface their bounded messages; client blocks bad input without a request', async ({ page }) => {
  await stubSession(page, true);
  await stubAccounts(page, Array.from({ length: 5 }, (_, i) => mkRow('ethereum', '0x' + String(i + 1).repeat(40), `w${i}`)));
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('w0')).toBeVisible();
  // Cap: the stub enforces 5 per network.
  await page.locator('#accounts-addr').fill(ETH1);
  await page.locator('#accounts-label').fill('one too many');
  await panel.getByRole('button', { name: 'Save address' }).click();
  await expect(panel.getByText('At most 5 saved addresses per network.')).toBeVisible();
  // Bad input: no request leaves the page (validated client-side).
  await page.locator('#accounts-addr').fill('not-an-address');
  await panel.getByRole('button', { name: 'Save address' }).click();
  await expect(panel.getByText('Enter an Ethereum address: 0x followed by 40 hexadecimal characters.')).toBeVisible();
});

test('Use in Track prefills the lookup form and switches network without firing a lookup', async ({ page }, info) => {
  await stubSession(page, true);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet'), mkRow('solana', SOL1, 'Solar')]);
  let lookups = 0;
  await page.route('**/api/v1/portfolio/resolve', (r) => {
    lookups += 1;
    return r.abort();
  });
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('Solar')).toBeVisible();
  // Network starts on Ethereum; choosing the Solana row must switch it and fill the input.
  await panel.getByRole('listitem').filter({ hasText: 'Solar' }).getByRole('button', { name: 'Use in Track' }).click();
  const trackInput = page.locator('.track input').first();
  await expect(trackInput).toHaveValue(SOL1);
  await expect(trackInput).toBeFocused();
  await expect(page.locator('.track').getByRole('button', { name: 'Solana (SOL only)' })).toHaveAttribute('aria-pressed', 'true');
  expect(lookups).toBe(0); // no automatic provider request
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-useintrack.png` });
});

// Identity switch or expiry mid-session (review F2): a delayed response from the OLD identity
// must never commit into the NEW identity's panel - not a stale list paint, not a mutation echo.

test('a delayed list response from the previous identity never paints after a switch', async ({ page }) => {
  let identity = 'jun@example.com';
  // Short token life: the app's own expiry path clears the identity and renews it mid-session.
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        via: 'cloudflare-access',
        identity: { email: identity },
        expiresAt: new Date(Date.now() + 2000).toISOString(),
      }),
    }),
  );
  // First GET (identity A) is gated; its rows are captured at request time. Later GETs (B) answer at once.
  let releaseA: (() => void) | null = null;
  let firstGet = true;
  await page.route('**/api/v1/portfolio/accounts', async (route) => {
    const body = { accounts: [mkRow('ethereum', ETH1, 'A cold wallet')], limits: { maxPerNetwork: 5 } };
    const bodyB = { accounts: [mkRow('solana', SOL1, 'B solar')], limits: { maxPerNetwork: 5 } };
    const chosen = firstGet ? body : bodyB;
    if (firstGet) {
      firstGet = false;
      await new Promise<void>((resolve) => {
        releaseA = resolve;
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'r', ...chosen }) });
  });
  await page.goto('/track');
  const panel = page.locator('.accounts');
  // A's list is still in flight when the token expires and the renewal answers as identity B.
  identity = 'sam@example.com';
  await expect(panel.getByText('B solar')).toBeVisible({ timeout: 10000 }); // expiry -> renewal -> B's list
  releaseA!(); // A's slow response lands now: it must be dropped (aborted + stale-guarded).
  await page.waitForTimeout(300); // give a misbehaving paint its window
  await expect(panel.getByText('A cold wallet')).toHaveCount(0);
  await expect(panel.getByText('B solar')).toBeVisible();
});

test('a delayed remove resolving after an identity switch does not commit or refresh into the new panel', async ({ page }) => {
  let identity = 'jun@example.com';
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        via: 'cloudflare-access',
        identity: { email: identity },
        expiresAt: new Date(Date.now() + 3000).toISOString(),
      }),
    }),
  );
  // One route: A's list first, every later GET is the new identity's (empty) list, DELETE gated.
  let releaseDelete: (() => void) | null = null;
  let servedFirstList = false;
  await page.route('**/api/v1/portfolio/accounts', async (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') {
      await new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'r', removed: true }) });
    }
    const accounts = servedFirstList ? [] : [mkRow('ethereum', ETH1, 'A cold wallet')];
    servedFirstList = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'r', accounts, limits: { maxPerNetwork: 5 } }) });
  });
  await page.goto('/track');
  const panel = page.locator('.accounts');
  await expect(panel.getByText('A cold wallet')).toBeVisible();
  await panel.getByRole('button', { name: 'Remove' }).first().click();
  await panel.getByRole('button', { name: 'Remove it' }).click(); // DELETE is now in flight, gated
  identity = 'sam@example.com'; // token expires mid-delete; renewal answers as B
  await expect(panel.getByText('None saved.').first()).toBeVisible({ timeout: 10000 }); // expiry -> renewal -> B's empty list
  releaseDelete!(); // the old identity's mutation resolves: no commit, no stale paint, no error
  await page.waitForTimeout(300); // give a misbehaving paint its window
  await expect(panel.getByText('None saved.').first()).toBeVisible();
  await expect(panel.getByText('A cold wallet')).toHaveCount(0);
});
