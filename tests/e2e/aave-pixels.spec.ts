import { expect, test, type Page } from '@playwright/test';

// Actual-pixel captures of the Aave V3 section for pre-release visual verification.
// Data is mocked at the network layer; the pixels are the real built app.
const ADDR = '0x1111111111111111111111111111111111111112';
const aaveOk = {
  status: 'ok',
  positions: [
    {
      underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
      // Real-magnitude long formatted values: the defect they guard against is a
      // formatted number splitting mid-value across two lines in a narrow cell.
      supplied: '11392.069003',
      variableDebt: '0',
      suppliedValueUsd: '11390.54',
      variableDebtValueUsd: '0',
      priceSource: 'chainlink:USDC/USD',
      priceObservedAt: '2026-10-23T11:58:00Z',
      observedAt: '2026-10-21T02:13:20Z',
      usageAsCollateralEnabled: true,
      reserveNote: null,
    },
    {
      underlyingAsset: '0x6b175474e89094c44da98b954eedeac495271d0f',
      symbol: 'DAI',
      decimals: 18,
      supplied: '0',
      variableDebt: '1234567.891234567890123456',
      suppliedValueUsd: '0',
      variableDebtValueUsd: '1234567.89',
      priceSource: 'chainlink:DAI/USD',
      priceObservedAt: '2026-10-23T11:58:00Z',
      observedAt: '2026-10-21T02:14:20Z',
      usageAsCollateralEnabled: false,
      reserveNote: 'This reserve is frozen on Aave.',
    },
  ],
};
const baseWallet = {
  address: ADDR,
  assets: [
    { assetId: 'eth', symbol: 'ETH', decimals: 18, amount: '1.5', price: '2000.00', value: '3000.00' },
  ],
  partial: false,
  warnings: [],
};
const body = (aave: unknown) => ({
  schemaVersion: 1,
  requestId: 'r',
  generatedAt: '2026-10-23T12:00:00Z',
  observedAt: '2026-10-23T12:00:00Z',
  provider: 'fixture',
  chainId: 1,
  mode: 'mock',
  simulated: true,
  wallets: [{ ...baseWallet, aave }],
  totals: { recognizedPricedSubtotalUsd: '3000.00', unpricedAssetCount: 0, note: 'Wallet balances only: DeFi deposits, staking, debts, LP claims and other positions may be missing; Aave V3 positions are listed separately and are never added to this subtotal; the subtotal is not total net worth.' },
  partial: false,
  warnings: [],
});

async function setup(page: Page, aave: unknown) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/health', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', mode: 'mock', aave: true, requestId: 'r' }) }),
  );
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: null }) }),
  );
  await page.route('**/api/v1/portfolio/resolve', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body(aave)) }),
  );
  await page.goto('/track/');
  await page.locator('#main').getByRole('textbox').fill(ADDR);
  await page.locator('#main').getByRole('button', { name: /look up/i }).click();
  await expect(page.locator('#main').getByRole('heading', { name: 'Aave V3 positions (Ethereum)' })).toBeVisible();
}

test.describe('Aave V3 section pixels', () => {
  test('positions state at desktop 1280, mobile 390 and narrow 320', async ({ page }) => {
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, aaveOk);
      // No horizontal overflow at any width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // Formatted amounts never wrap mid-number: each .amt-num renders on one line.
      for (const el of await page.locator('#main .aave-table .amt-num').all()) {
        expect(await el.evaluate((n) => getComputedStyle(n).whiteSpace)).toBe('nowrap');
        expect(await el.evaluate((n) => n.getBoundingClientRect().height)).toBeLessThanOrEqual(
          await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize) * 1.6),
        );
      }
      await page.screenshot({ path: `output/playwright/aave-positions-${width}.png`, fullPage: true });
    }
  });
  test('unavailable and true-empty states at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await setup(page, { status: 'unavailable', reason: 'rate_limited' });
    await page.screenshot({ path: 'output/playwright/aave-unavailable-390.png', fullPage: true });
    await setup(page, { status: 'ok', positions: [] });
    await expect(page.locator('#main').getByText(/No supplied or variable-debt positions were found/)).toBeVisible();
    await page.screenshot({ path: 'output/playwright/aave-empty-390.png', fullPage: true });
  });
});
