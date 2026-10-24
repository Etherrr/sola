import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ADDR = '0x1111111111111111111111111111111111111112';
const okBody = {
  schemaVersion: 1,
  requestId: 'r',
  generatedAt: '2026-10-23T12:00:00Z',
  observedAt: '2026-10-23T12:00:00Z',
  provider: 'fixture',
  chainId: 1,
  mode: 'mock',
  simulated: true,
  wallets: [
    {
      address: ADDR,
      assets: [
        {
          assetId: 'eth',
          symbol: 'ETH',
          decimals: 18,
          amount: '1.5',
          price: '2000.00',
          value: '3000.00',
        },
        { assetId: 'x', symbol: 'XYZ', decimals: 6, amount: '10', price: null, value: null },
      ],
      partial: false,
      warnings: [],
    },
  ],
  totals: { recognizedPricedSubtotalUsd: '3000.00', unpricedAssetCount: 1, note: 'n' },
  partial: false,
  warnings: [],
};
const mock = (page: Page, status: number, body: unknown, ct = 'application/json') =>
  page.route('**/api/v1/portfolio/resolve', (r) =>
    r.fulfill({
      status,
      contentType: ct,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

test.beforeEach(async ({ page }) => {
  // The welcome screen has its own tests; skip it here.
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
  // The static test server has no API; answer the session check so it is not a console error.
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: null }),
    }),
  );
});
test.describe('/track simulated lookup', () => {
  test('shows a simulated result with Unknown prices and no console errors', async ({ page }) => {
    // Smooth scrolling to the result would move targets while axe measures them.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    let posted = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => {
      posted += 1;
      expect(r.request().method()).toBe('POST');
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okBody),
      });
    });
    await page.goto('/track/');
    await page.getByRole('button', { name: 'Mixed tokens' }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByText('Unknown').first()).toBeVisible();
    await expect(page.getByText(/Nothing was read from a blockchain/)).toBeVisible();
    expect(posted).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    // The sticky top bar can partly cover controls that scrolled under it; measure from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
  test('after a lookup the result or error start and focus are visible between the fixed bars', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const many = Array.from({ length: 30 }, (_, i) => ({
      assetId: 'a' + i,
      symbol: i === 0 ? 'A'.repeat(40) : 'TKN' + i,
      decimals: 18,
      amount: i === 0 ? '123456789012345678901234567890.123456789' : '1',
      price: null,
      value: null,
    }));
    const tall = {
      ...okBody,
      wallets: [{ ...okBody.wallets[0], assets: many }],
      totals: { ...okBody.totals, unpricedAssetCount: 30 },
    };
    const geometry = () =>
      page.evaluate(() => {
        const out = document.querySelector('.track-output') as HTMLElement;
        const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect();
        const side = (document.querySelector('.side') as HTMLElement).getBoundingClientRect();
        const r = out.getBoundingClientRect();
        const lowerBar = side.top > 100 ? side.top : window.innerHeight;
        return {
          focused: document.activeElement === out,
          topClear: r.top >= bar.bottom - 1,
          startAboveLowerBar: r.top + 40 <= lowerBar,
          noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
    for (const [status, body] of [
      [200, tall],
      [503, { error: { code: 'disabled', message: 'x' }, requestId: 'r' }],
    ] as const) {
      await page.unroute('**/api/v1/portfolio/resolve').catch(() => {});
      await mock(page, status, body);
      await page.goto('/track/');
      await page.getByRole('button', { name: 'Mixed tokens' }).click();
      await expect(
        page.locator('.track-output [role],.track-output h2,.track-output .notice').first(),
      ).toBeVisible();
      expect(await geometry()).toEqual({
        focused: true,
        topClear: true,
        startAboveLowerBar: true,
        noHScroll: true,
      });
    }
  });
  test('Shift+Tab and Tab after a lookup never leave a focused control under a fixed bar', async ({
    page,
  }) => {
    await page.route('**/api/v1/portfolio/resolve', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okBody) }),
    );
    await page.goto('/track/');
    await page.getByRole('button', { name: 'Mixed tokens' }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    const probe = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect();
        const side = (document.querySelector('.side') as HTMLElement).getBoundingClientRect();
        const lower = side.top > 100 ? side.top : window.innerHeight;
        const r = el.getBoundingClientRect();
        const inBar = !!el.closest('.topbar, .side, .skip-link');
        return {
          what: (el.textContent || el.tagName).slice(0, 24),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          bar: Math.round(bar.bottom),
          lower: Math.round(lower),
          ok: inBar || (r.top >= bar.bottom - 1 && r.bottom <= lower + 1),
        };
      });
    const bad: unknown[] = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(350);
      const p = await probe();
      if (!p.ok) bad.push(p);
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(350);
      const p = await probe();
      if (!p.ok) bad.push(p);
    }
    expect(bad).toEqual([]);
  });
  test('malformed 200, HTML 200 and wrong-address 200 show an error and no balances', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/track/');
    for (const [body, ct] of [
      [{ wallets: [] }, 'application/json'],
      ['<html>Access sign in</html>', 'text/html'],
      [
        { ...okBody, wallets: [{ ...okBody.wallets[0], address: '0x' + '2'.repeat(40) }] },
        'application/json',
      ],
      [{ ...okBody, simulated: undefined }, 'application/json'],
    ] as const) {
      await page.unroute('**/api/v1/portfolio/resolve').catch(() => {});
      await mock(page, 200, body, ct);
      await page.getByLabel(/Public Ethereum address/).fill(ADDR);
      await page.getByRole('button', { name: 'Look up' }).click();
      await expect(page.getByText('INCOMPLETE').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Result' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
  test('feature-off 503 reads as switched off, 401 as sign in, no balances', async ({ page }) => {
    await page.goto('/track/');
    await mock(page, 503, { error: { code: 'disabled', message: 'x' }, requestId: 'r' });
    await page.getByRole('button', { name: 'Empty wallet' }).click();
    await expect(page.getByText(/switched off on this deployment/)).toBeVisible();
    await page.unroute('**/api/v1/portfolio/resolve');
    await mock(page, 401, { error: { code: 'unauthorized', message: 'x' }, requestId: 'r' });
    await page.getByRole('button', { name: 'Empty wallet' }).click();
    await expect(page.getByText(/sign in through Access/)).toBeVisible();
    await expect(page.getByText(/No assets found/)).toHaveCount(0);
  });
  test('rejects bad input without a request, keeps focus, input is full width, skip link hidden', async ({
    page,
  }) => {
    let posted = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => ((posted += 1), r.abort()));
    await page.goto('/track/');
    const input = page.getByLabel(/Public Ethereum address/);
    await input.fill('vitalik.eth');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText(/0x followed by 40/).first()).toBeVisible();
    await expect(input).toBeFocused();
    expect(posted).toBe(0);
    const box = await input.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThan(Math.min(page.viewportSize()!.width - 60, 300));
    const skip = await page.locator('.skip-link').boundingBox();
    expect(skip!.y + skip!.height).toBeLessThanOrEqual(0);
  });
  test('keyboard: Tab reaches the skip link first and it becomes visible', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard path');
    await page.goto('/track/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    const b = await page.locator('.skip-link').boundingBox();
    expect(b!.y).toBeGreaterThanOrEqual(0);
  });
});
