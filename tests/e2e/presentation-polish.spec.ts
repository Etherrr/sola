import { test, expect } from '@playwright/test';
for (const width of [320, 390, 1280])
  test(`sign-in and settings polish at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/api/v1/**', (r) =>
      r.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"auth_required"}',
      }),
    );
    await page.goto('/sign-in/');
    await expect(
      page.getByText('Sign a message, never a transaction or approval.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Invitation required.', { exact: false })).toBeVisible();
    await expect(
      page.getByText('Wallet-only accounts have no email recovery.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Clearing your selection', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Find wallets', exact: true }).focus();
    await page.screenshot({ path: `/downloads/polish-signin-${width}.png` });
    await page.keyboard.press('Enter');
    await expect(page.getByText('Clearing your selection', { exact: false })).toBeVisible();
    const email = page.getByLabel('Email you were invited with');
    await email.focus();
    await email.fill('user@example.test');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Send sign-in code', exact: true }),
    ).toBeFocused();
    await page.screenshot({ path: `/downloads/polish-email-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/settings/');
    await expect(page.getByRole('heading', { name: 'Sign-in and saved addresses' })).toBeVisible();
    await expect(
      page.getByText('Sign in with a wallet message, an email code or a passkey', { exact: false }),
    ).toBeVisible();
    await page.screenshot({ path: `/downloads/polish-settings-${width}.png` });
    await page
      .getByRole('heading', { name: 'Privacy and external links' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/downloads/polish-settings-lower-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
