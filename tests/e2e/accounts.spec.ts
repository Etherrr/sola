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
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
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

  // Clear-all is a two-step confirm.
  await panel.getByRole('button', { name: 'Clear all saved addresses' }).click();
  await expect(panel.getByText('Clear every saved address?')).toBeVisible();
  await panel.getByText('Clear every saved address?').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/accounts-${info.project.name}-clear-confirm.png` });
  await panel.getByRole('button', { name: 'Clear everything' }).click();
  await expect(panel.getByText('None saved.').first()).toBeVisible();
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
