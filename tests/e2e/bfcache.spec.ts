import { test, expect, type Page } from '@playwright/test';

// bfcache / frozen-snapshot behavior: a page restored after the session was revoked must
// never repaint identity or saved addresses. Layered defense under test: HTML no-store
// (served by the preview server, mirroring public/_headers), a pagehide mask over
// [data-sensitive] surfaces, and pageshow revalidation that fails closed.
const ETH1 = '0x' + 'a'.repeat(40);
const EMAIL = 'jun@example.com';

type Row = { network: 'ethereum' | 'solana'; address: string; label: string; createdAt: string; updatedAt: string };
const mkRow = (network: Row['network'], address: string, label: string): Row => ({
  network, address, label,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
});

async function stubAccounts(page: Page, seed: Row[]) {
  const rows = [...seed];
  await page.route('**/api/v1/portfolio/accounts', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: 'r', accounts: rows, limits: { maxPerNetwork: 5 } }) });
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });
}

function stubSessionFlippable(page: Page, state: { verified: boolean }) {
  return page.route('**/api/v1/session', (r) =>
    state.verified
      ? r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ok',
            via: 'cloudflare-access',
            identity: { email: EMAIL },
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        })
      : r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
}


// The greeting collapses at narrow widths; open the account menu to reveal the identity.
async function showIdentity(page: Page) {
  // The greeting span stays display:none at narrow widths; the panel identity is reliable.
  // A session state flip can close the panel mid-check, so poll and re-open as needed.
  const panelEmail = page.locator('.acct-panel').getByText(EMAIL);
  const btn = page.getByRole('button', { name: /^Account:/ });
  for (let i = 0; i < 24; i++) {
    if (await panelEmail.isVisible().catch(() => false)) return;
    if (!(await page.locator('.acct-panel').isVisible().catch(() => false))) await btn.click();
    await page.waitForTimeout(250);
  }
  await expect(panelEmail).toBeVisible();
}
async function expectRejected(page: Page) {
  await expect(page.getByText(EMAIL)).toHaveCount(0);
  const t = page.getByText('Your session could not be verified.');
  const btn = page.getByRole('button', { name: /^Account:/ });
  for (let i = 0; i < 24; i++) {
    if (await t.isVisible().catch(() => false)) return;
    if (!(await page.locator('.acct-panel').isVisible().catch(() => false))) await btn.click();
    await page.waitForTimeout(250);
  }
  await expect(t).toBeVisible();
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

test('frozen snapshot masks identity and saved addresses; a revoked session never repaints them', async ({ page }) => {
  const session = { verified: true };
  await stubSessionFlippable(page, session);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet')]);
  await page.goto('/track/');
  await showIdentity(page);
  await expect(page.getByText('Cold wallet')).toBeVisible();

  // The page is frozen into the bfcache with data painted: the mask covers it in the snapshot.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('html')).toHaveClass(/bfcache-mask/);
  await expect(page.locator('.acct')).toBeHidden();
  await expect(page.getByText('Cold wallet')).toBeHidden();

  // Logout happens while the page is frozen; the restore revalidates and fails closed.
  session.verified = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expectRejected(page);
  await expect(page.getByText('Cold wallet')).toHaveCount(0);
  // The mask is lifted after the settled check - never a permanently blank screen.
  await expect(page.locator('html')).not.toHaveClass(/bfcache-mask/);
});

test('a still-valid session survives the same round trip with its data restored', async ({ page }) => {
  const session = { verified: true };
  await stubSessionFlippable(page, session);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet')]);
  await page.goto('/track/');
  await showIdentity(page);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.acct')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  // Revalidation confirms the session: identity and list come back, mask lifts.
  await showIdentity(page);
  await expect(page.getByText('Cold wallet')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/bfcache-mask/);
});

test('real back navigation after logout (HTML no-store) shows no stale identity or saved rows', async ({ page }) => {
  const session = { verified: true };
  await stubSessionFlippable(page, session);
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet')]);
  await page.goto('/track/');
  await showIdentity(page);
  await expect(page.getByText('Cold wallet')).toBeVisible();

  // Navigate away (the real logout target is off-app), revoke, then go back.
  await page.goto('/learn/');
  await showIdentity(page);
  session.verified = false;
  await page.goBack();
  // Whether the engine restores from bfcache or reloads (no-store), stale data must not paint.
  await expectRejected(page);
  await expect(page.getByText('Cold wallet')).toHaveCount(0);
});
