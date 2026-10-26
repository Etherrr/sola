import { test, expect } from '@playwright/test';
test('retired sample bookmarks reach actual native views without sample flash', async ({
  page,
}, info) => {
  await page.route('**/api/v1/**', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"auth_required"}' }),
  );
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"status":"ok","email":"user@example.test","fresh":true}',
    }),
  );
  for (const endpoint of ['summary', 'overview', 'assets', 'positions', 'risk'])
    await page.route(`**/api/v1/portfolio/${endpoint}`, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"status":"empty","reason":"no_recorded_observations","newerPartial":false,"newerUnattributed":false}',
      }),
    );
  for (const [route, dest] of Object.entries({
    demo: 'overview',
    'demo/assets': 'assets',
    'demo/positions': 'defi',
    'demo/risk': 'risk',
    'portfolio/assets': 'assets',
    'portfolio/positions': 'defi',
    'portfolio/risk': 'risk',
  })) {
    await page.goto('/' + route + '/');
    await expect(page).toHaveURL(new RegExp(`/account/${dest}/?$`));
    await expect(page.locator('body')).not.toContainText('$12,000');
    await expect(page.locator('body')).not.toContainText('Priced net sample value');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: `/downloads/retired-portfolio-${info.project.name}.png` });
});

test('retired bookmark retains native fallback without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport:
      info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto('/demo/assets/');
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Continue to Assets', exact: true });
  await expect(link).toHaveAttribute('href', '/account/assets/');
  await expect(link).toBeVisible();
  await page.screenshot({ path: `/downloads/retired-fallback-${info.project.name}.png` });
  await link.click();
  await expect(page).toHaveURL(/\/account\/assets\/?$/);
  await context.close();
});
