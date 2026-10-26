import { expect, test, type Page } from '@playwright/test';

/**
 * The gated native account page, desktop + mobile. APIs intercepted with
 * contract-faithful stand-ins (real handlers: tests/portfolio-addresses.test.ts
 * + live staging probes). Proves: no session -> redirect to sign-in with a
 * validated resume destination; signed-in but NOT invited -> honest state,
 * never empty holdings; invited -> the account renders; the full door ->
 * sign-in -> account path lands.
 */

const SESS = '**/api/v1/auth/email/session';
const ADDR = '**/api/v1/portfolio/addresses';

async function mockSession(page: Page, mode: 'none' | 'ok') {
  await page.route(SESS, (r) =>
    mode === 'none'
      ? r.fulfill({ status: 401, json: { error: 'auth_required' } })
      : r.fulfill({ status: 200, json: { status: 'ok', email: 'jun@example.com', fresh: true } }),
  );
}

test('no session redirects to sign-in carrying the resume destination', async ({ page }) => {
  await mockSession(page, 'none');
  await page.goto('/account/');
  await expect(page).toHaveURL(/\/sign-in\/\?next=%2Faccount/);
  await expect(page.getByLabel(/email you were invited with/i)).toBeVisible();
});

test('signed in but not invited: honest state, never empty holdings', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 403, json: { error: 'not_entitled' } }));
  await page.goto('/account/');
  await expect(page.getByRole('heading', { name: 'Not invited yet' })).toBeVisible();
  await expect(page.getByText('not because your account is empty')).toBeVisible();
  await expect(page.getByText('Signed in as jun@example.com')).toBeVisible();
});

test('invited session renders the account and sign-out control', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.goto('/account/');
  await expect(page.getByText('Signed in as jun@example.com.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('full path: sign-in ceremony resumes into the gated account', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/challenge', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', expiresAt: '2026-10-25T20:00:00Z' } }),
  );
  await page.route('**/api/v1/auth/email/verify', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', user: { id: 'u-fixture' } } }),
  );
  await page.goto('/sign-in/?next=%2Faccount');
  await page.getByLabel(/email you were invited with/i).fill('jun@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/code sent to/i).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const cont = page.getByRole('link', { name: 'Continue' });
  await expect(cont).toHaveAttribute('href', '/account');
  await cont.click();
  await expect(page.getByText('Signed in as jun@example.com.')).toBeVisible();
});

test('failed sign-out keeps the truth visible - no fake signed-out navigation', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/logout', (r) => r.fulfill({ status: 500, json: { error: 'x' } }));
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});

test('a 403 that is not not_entitled shows the honest error, not "not invited"', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 403, json: { error: 'forbidden_origin' } }));
  await page.goto('/account/');
  await expect(page.getByText('could not be read just now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not invited yet' })).toHaveCount(0);
});

test('stale session (data 401 after session ok) asks for a fresh sign-in, no redirect loop', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 401, json: { error: 'auth_required' } }));
  await page.goto('/account/');
  await expect(page.getByText('Your sign-in needs a refresh.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in/?next=%2Faccount');
});

test('sign-out with a dead network keeps you signed in and honest - no fake navigation', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.goto('/account/');
  await page.route('**/api/v1/auth/email/logout', (r) => r.abort('timedout'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});

test('header menu sign-out failure alerts and keeps you signed in - no fake reload', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/logout', (r) => r.fulfill({ status: 500, json: { error: 'x' } }));
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Account: jun@example.com' }).click();
  await page.getByRole('group', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('group', { name: 'Account' }).locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});
