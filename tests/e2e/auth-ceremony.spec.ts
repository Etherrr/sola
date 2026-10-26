import { expect, test, type Page } from '@playwright/test';

/**
 * Email-code ceremony client flow, desktop + mobile. The API is intercepted
 * with a stateful stand-in enforcing the DOCUMENTED server contract (the real
 * handlers are covered by tests/auth-email-handlers.test.ts and live staging
 * probes); this spec proves the client drives the ceremony honestly and the
 * resume destination is validated against open redirects.
 */

const CH = '**/api/v1/auth/email/challenge';
const VE = '**/api/v1/auth/email/verify';

async function mockAuth(page: Page) {
  await page.route(CH, async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 405, json: { error: 'method_not_allowed' } });
    const body = route.request().postDataJSON() as { email?: string };
    if (!body.email || !body.email.includes('@'))
      return route.fulfill({ status: 400, json: { error: 'invalid_email' } });
    return route.fulfill({ status: 200, json: { status: 'ok', expiresAt: '2026-10-25T20:00:00Z' } });
  });
  await page.route(VE, async (route) => {
    const body = route.request().postDataJSON() as { email?: string; code?: string };
    if (body.email === 'locked@example.com')
      return route.fulfill({ status: 429, json: { error: 'too_many_attempts' } });
    if (body.code !== '123456') return route.fulfill({ status: 401, json: { error: 'invalid_code' } });
    return route.fulfill({
      status: 200,
      json: { status: 'ok', user: { id: 'u-fixture' } },
      headers: { 'set-cookie': '__Host-sola_session=fixture; Path=/; HttpOnly; Secure; SameSite=Lax' },
    });
  });
}

test('full email-code ceremony signs in and Continue honors a valid next', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/dev/sign-in/?next=/portfolio?tab=assets'); // trailing slash: serve 308 strips the query otherwise
  await page.getByLabel(/email you were invited with/i).fill('jun@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/code sent to jun@example.com/i).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in as jun@example.com.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/portfolio?tab=assets');
});

test('open-redirect next values fall back to the default destination', async ({ page }) => {
  await mockAuth(page);
  for (const bad of ['//evil.example/x', '/%2f%2fevil.example', 'https://evil.example']) {
    await page.goto(`/dev/sign-in/?next=${encodeURIComponent(bad)}`);
    await page.getByLabel(/email you were invited with/i).fill('jun@example.com');
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await page.getByLabel(/code sent to/i).fill('123456');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/account');
  }
});

test('wrong code and lockout render honest errors, no fake success', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/dev/sign-in/');
  await page.getByLabel(/email you were invited with/i).fill('jun@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/code sent to/i).fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toContainText('That code is not right');
  await page.goto('/dev/sign-in/');
  await page.getByLabel(/email you were invited with/i).fill('locked@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/code sent to/i).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Too many wrong codes');
});
