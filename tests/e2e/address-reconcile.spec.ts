import { expect, test, type Page } from '@playwright/test';

/**
 * Cold-add timeout reconciliation on the address book (reviewer-requested pins
 * for the reconcile path, head after 484e304). The client aborts a slow write;
 * the server may still commit it late. Pins:
 *  - landed:  reconcile GET finds the natural key -> success path, entry listed
 *  - absent:  reconcile GET misses -> honest "may still have been added" note,
 *             never a definitive failure claim, never a silent retry
 *  - 409:     a duplicate save shows "already in your list", not a failure
 * APIs intercepted with contract-faithful stand-ins; no chain reads, no real
 * user data (synthetic fixtures only).
 */

const SESS = '**/api/v1/auth/email/session';
const ADDR = '**/api/v1/portfolio/addresses';

const ENTRY = {
  network: 'ethereum',
  address: '0x' + 'a'.repeat(40),
  label: 'Cold wallet',
  verification: 'watched',
  createdAt: '2026-10-25T20:00:00.000Z',
  lastObservedAt: null,
};

async function mockSession(page: Page) {
  await page.route(SESS, (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', email: 'jun@example.com', fresh: true } }),
  );
}

async function openAccount(page: Page) {
  await page.goto('/account/');
  await expect(page.getByText('No addresses yet - add one to watch its balances.')).toBeVisible();
}

async function fillAndSave(page: Page) {
  await page.getByPlaceholder('0x… or Solana address').fill(ENTRY.address);
  await page.getByPlaceholder('A name you recognize').fill(ENTRY.label);
  await page.getByRole('button', { name: 'Add address' }).click();
}

test('a timed-out write that still landed reconciles to success and lists the entry', async ({ page }) => {
  await mockSession(page);
  // The write aborts client-side, but the server committed late: every GET
  // after the POST returns the entry under its natural key.
  let posted = false;
  await page.route(ADDR, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        json: { status: 'ok', addresses: posted ? [ENTRY] : [] },
      });
    }
    posted = true;
    return route.abort();
  });
  await openAccount(page);
  await fillAndSave(page);
  await expect(page.getByText('Cold wallet')).toBeVisible();
  await expect(page.getByPlaceholder('0x… or Solana address')).toHaveValue('');
  await expect(page.locator('p.form-alert')).toHaveCount(0);
});

test('a timed-out write that did not land shows the honest check-your-list note', async ({ page }) => {
  await mockSession(page);
  let posts = 0;
  await page.route(ADDR, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, json: { status: 'ok', addresses: [] } });
    }
    posts += 1;
    return route.abort();
  });
  await openAccount(page);
  await fillAndSave(page);
  await expect(
    page.locator('p.form-alert'),
  ).toHaveText('That took too long - it may still have been added. Check your list, then try again if it is missing.');
  await expect(page.getByText('Cold wallet')).toHaveCount(0);
  expect(posts).toBe(1); // no silent retry of the write
});

test('a duplicate save shows the honest already-in-your-list message, not a failure', async ({ page }) => {
  await mockSession(page);
  let posts = 0;
  await page.route(ADDR, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, json: { status: 'ok', addresses: [] } });
    }
    posts += 1;
    return route.fulfill({ status: 409, json: { error: 'address_exists' } });
  });
  await openAccount(page);
  await fillAndSave(page);
  await expect(page.locator('p.form-alert')).toHaveText('That address is already in your list.');
  expect(posts).toBe(1);
});
