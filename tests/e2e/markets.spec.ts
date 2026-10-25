import { test, expect, type Page } from '@playwright/test';
import { INSTRUMENTS } from '../../server/markets/instruments';

// Synthetic fixture only: the stubbed API reads no chain and no vendor.
const obs = (id: string, value: string) => {
  const inst = INSTRUMENTS.find((i) => i.id === id)!;
  return {
    metric: 'overview',
    instrument: inst.symbol,
    name: inst.name,
    kind: inst.kind,
    issuer: inst.issuer,
    underlying: inst.underlying,
    chain: 'solana',
    mint: inst.mint,
    value,
    unit: 'USD',
    primaryVenue: 'orca',
    primaryPairAddress: 'A'.repeat(44),
    venues: ['orca', 'raydium'],
    venueCount: 2,
    liquidityUsdApprox: '2000000',
    dispersionPct: '0.20',
    source: 'DexScreener',
    sourceUpdatedAt: null,
    coverage: 'selected-venues',
    warnings: [],
  };
};
const payload = {
  schemaVersion: 1,
  status: 'available',
  source: 'DexScreener',
  stale: false,
  retrievedAt: new Date().toISOString(),
  cacheAgeSeconds: 12,
  staleAfterSeconds: 60,
  observations: [obs('sol', '102.41'), obs('tslax', '371.52')],
  unpriced: [{ instrument: 'NVDAx', reason: 'no-qualified-venue' }],
};

async function stubOverview(page: Page, mode: 'ok' | 'disabled' | 'broken') {
  await page.route('**/api/v1/markets/overview*', (r) => {
    if (mode === 'ok')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    if (mode === 'disabled')
      return r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'disabled', message: 'off' }, requestId: 'r' }),
      });
    return r.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'source_unavailable', message: 'down' }, requestId: 'r' }),
    });
  });
}

test.describe('markets overview', () => {
  test('renders priced instruments with issuer, venue and retrieval labels', async ({ page }) => {
    await stubOverview(page, 'ok');
    await page.goto('/markets');
    await expect(page.getByText('LIVE ON-CHAIN')).toBeVisible();
    await expect(page.getByRole('heading', { name: /TSLAx/ })).toBeVisible();
    await expect(page.getByText('$371.52')).toBeVisible();
    await expect(page.getByText('TOKENIZED EQUITY · Backed (xStocks)')).toBeVisible();
    await expect(
      page.getByText('An on-chain token that tracks TSLA. It is not the stock itself'),
    ).toBeVisible();
    await expect(page.getByText('orca (+1 more)').first()).toBeVisible();
    await expect(page.getByText(/Retrieved .*UTC/)).toBeVisible();
    await expect(page.getByText(/not the whole market/).first()).toBeVisible();
    await expect(page.getByText(/Not priced this refresh: NVDAx/)).toBeVisible();
    // Derivatives indicators remain honestly unavailable.
    await expect(page.getByText('Not available').first()).toBeVisible();
    // No source "updated" claim exists anywhere on the page.
    await expect(page.getByText(/[Uu]pdated/)).toHaveCount(3); // the "Source updated" label on the 3 legacy cards; no observation claims a source time
  });

  test('a disabled feature shows the unavailable state, never figures', async ({ page }) => {
    await stubOverview(page, 'disabled');
    await page.goto('/markets');
    await expect(page.getByText('DATA UNAVAILABLE', { exact: true })).toBeVisible();
    await expect(page.getByText('switched off or not configured')).toBeVisible();
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test('a source failure offers a retry and substitutes nothing', async ({ page }) => {
    await stubOverview(page, 'broken');
    await page.goto('/markets');
    await expect(page.getByText('Prices are unavailable.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
  });

  test('explicit refresh re-requests the overview with the force flag', async ({ page }) => {
    const urls: string[] = [];
    await page.route('**/api/v1/markets/overview*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('/markets');
    await expect(page.getByText('$371.52')).toBeVisible();
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('refresh=1');
    await page.getByRole('button', { name: 'Refresh prices' }).click();
    await expect(page.getByText('$371.52')).toBeVisible();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('refresh=1');
  });

  test('a long-open page ages into stale without any background request', async ({ page }) => {
    let calls = 0;
    const aged = {
      ...payload,
      retrievedAt: new Date(Date.now() - 55_000).toISOString(),
      cacheAgeSeconds: 55,
    };
    await page.route('**/api/v1/markets/overview*', (r) => {
      calls += 1;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aged) });
    });
    await page.goto('/markets');
    await expect(page.getByText('LIVE ON-CHAIN')).toBeVisible();
    // Cross the 60s freshness window with the page left open.
    await expect(page.getByText('STALE VALUES')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/6\ds ago/)).toBeVisible();
    // The age advanced purely on the render clock: exactly one request was ever made.
    expect(calls).toBe(1);
  });
});
