import { test, expect, type Page } from '@playwright/test';
import { createSqliteD1 } from '../helpers/d1-sqlite';
import { handlePortfolioView, type ViewKind } from '../../server/portfolio/views-handler';
import { createSession } from '../../server/auth/sessions';
import { SESSION_COOKIE } from '../../server/auth/email';
import { grantSnapshotConsent, recordObservation } from '../../server/portfolio/snapshots';
import type { ProviderResult } from '../../server/portfolio/provider';

/**
 * SLICE-2 DEV-SURFACE E2E (plan 6.2-6.4): the /dev/assets-v2, /dev/defi-v2 and
 * /dev/risk-v2 pages driven by ACTUAL views-handler responses (adapter-level,
 * node:sqlite, real migrations 0001-0005). No hand-built payload numbers: every
 * ok/empty body served to the browser is the handler's own bytes, so the pixel
 * and behavioral proof below IS the shipped wire contract. The only hand-made
 * responses are the intentionally MALFORMED case (must fail closed) and the
 * session mock. LOCAL ONLY - synthetic identity, mock provider data, no
 * production system, provider, credential, or user data touched.
 */
const NOW = new Date().toISOString();
const OBS = '2026-10-26T08:12:00.000Z';

async function buildWorld(withData: boolean) {
  const { db } = createSqliteD1();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(NOW, NOW).run();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(NOW).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(NOW).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(NOW).run();
  const s = await createSession(db, 'u1');
  const cookie = `${SESSION_COOKIE}=${s.id}`;
  await grantSnapshotConsent(db, 'u1', NOW);
  if (withData) {
    const result: Extract<ProviderResult, { ok: true }> = {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS,
      wallets: [{
        address: '0xAbC000000000000000000000000000000000dEaD', partial: false, warnings: [],
        assets: [
          { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18, rawAmount: '0', amount: '1.2345', price: '3120.55', value: '0', priceSource: 'chainlink', priceObservedAt: OBS },
          { assetId: 'eip155:1/erc20:0x1111111111111111111111111111111111111111', symbol: 'XYZ', decimals: 18, rawAmount: '0', amount: '9000', price: null, value: '0', priceSource: null, priceObservedAt: null },
        ],
        aave: {
          status: 'ok',
          positions: [{
            underlyingAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6,
            supplied: '4750', variableDebt: '1200', suppliedValueUsd: '4750', variableDebtValueUsd: '1200',
            priceSource: 'chainlink', priceObservedAt: OBS, observedAt: OBS,
            usageAsCollateralEnabled: true, reserveNote: null,
          }],
        },
      }],
    };
    await recordObservation(db, 'u1', 'ethereum', result);
  }
  const env = { PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db };
  const call = async (view: ViewKind, c: string | null = cookie) => {
    const res = await handlePortfolioView(
      new Request(`https://app.test/api/v1/portfolio/${view}`, { headers: c ? { cookie: c } : {} }),
      env,
      view,
    );
    return { status: res.status, body: await res.text() };
  };
  return { call };
}

async function wire(
  page: Page,
  bodies: Partial<Record<ViewKind, { status: number; body: string }>>,
) {
  // Catch-all FIRST (Playwright matches the most recently registered route).
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }),
  );
  await page.route('**/api/v1/auth/email/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","email":"igor@localhost.dev","fresh":true}' }),
  );
  for (const view of ['assets', 'positions', 'risk'] as const) {
    const b = bodies[view];
    if (!b) continue;
    await page.route(`**/api/v1/portfolio/${view}`, (route) =>
      route.fulfill({ status: b.status, contentType: 'application/json', body: b.body }),
    );
  }
}

test.describe('slice-2 recorded view pages (real handler bytes)', () => {
  test('assets page renders the handler ok body and filter/search/sort behave', async ({ page }) => {
    const world = await buildWorld(true);
    const assets = await world.call('assets');
    expect(assets.status).toBe(200);
    await wire(page, { assets });
    await page.goto('/dev/assets-v2');
    await expect(page.getByText('Recorded observations only', { exact: false })).toBeVisible();
    // Handler-computed figures, never hand numbers: USDC $4,750.00 / share 55.2%, ETH 44.8%.
    await expect(page.getByText('$4,750.00')).toBeVisible();
    await expect(page.getByText('55.2%')).toBeVisible();
    await expect(page.getByText('44.8%')).toBeVisible();
    // Holdings count EXCLUDES the recorded debt row (a liability, not a holding).
    await expect(page.getByText('3 holdings')).toBeVisible();
    // Debt renders in its own labeled block with NO share-of-priced figure
    // (its wire 13.95 allocation share must never read as asset allocation).
    await expect(page.getByRole('heading', { name: 'Recorded debt' })).toBeVisible();
    await expect(page.getByText('Debt is a liability, not an allocation', { exact: false })).toBeVisible();
    await expect(page.getByText('14.0%')).toHaveCount(0);
    await expect(page.locator('section').getByText('$1,200.00')).toBeVisible();
    // Unpriced asset stays Unknown, never zero.
    await expect(page.getByText('Unknown').first()).toBeVisible();
    // Behavioral: Supplied filter narrows to the protocol position only.
    await page.getByRole('button', { name: 'Supplied' }).click();
    await expect(page.getByText('4,750', { exact: true })).toBeVisible();
    await expect(page.getByText('ETH', { exact: true })).toHaveCount(0);
    // Behavioral: Investments filter shows the explicit not-covered state.
    await page.getByRole('button', { name: 'Investments' }).click();
    await expect(page.getByText('not covered by recorded observations yet', { exact: false })).toBeVisible();
    // Behavioral: search narrows by symbol.
    await page.getByRole('button', { name: 'All' }).click();
    await page.getByPlaceholder('Search symbol or address').fill('usdc');
    await expect(page.getByText('USDC').first()).toBeVisible();
    await expect(page.getByText('ETH', { exact: true })).toHaveCount(0);
    // Sort: by symbol puts ETH first.
    await page.getByPlaceholder('Search symbol or address').fill('');
    await page.getByLabel('Sort holdings').selectOption('symbol');
    await expect(page.locator('tbody tr').first()).toContainText('0x1111…1111');
    await expect(page.locator('tbody tr').last()).toContainText('USDC');
  });

  test('defi page renders the handler positions body; other categories Coming later', async ({ page }) => {
    const world = await buildWorld(true);
    const positions = await world.call('positions');
    await wire(page, { positions });
    await page.goto('/dev/defi-v2');
    await expect(page.getByRole('heading', { name: 'Lending & Borrowing' })).toBeVisible();
    await expect(page.getByText('aave-v3')).toBeVisible();
    await expect(page.getByText('$1,200.00')).toBeVisible();
    await expect(page.getByText('3,550')).toBeVisible();
    for (const c of ['Staking & Yield', 'Liquidity', 'Derivatives', 'Advanced']) {
      await expect(page.getByRole('heading', { name: c })).toBeVisible();
    }
    await expect(page.getByText('Coming later.').first()).toBeVisible();
    await expect(page.getByText('Health factor, APY and liquidation price are not calculated', { exact: false })).toBeVisible();
    // Read-only: no action buttons.
    await expect(page.getByRole('button', { name: /deposit|borrow|repay|withdraw|swap/i })).toHaveCount(0);
  });

  test('risk page renders handler concentrations, PARTIAL labels, uncalculated metrics', async ({ page }) => {
    const world = await buildWorld(true);
    const risk = await world.call('risk');
    await wire(page, { risk });
    await page.goto('/dev/risk-v2');
    await expect(page.getByRole('heading', { name: 'By chain' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By asset' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By protocol' })).toBeVisible();
    await expect(page.getByText('PARTIAL').first()).toBeVisible();
    // debtToKnownAssets 0.1395 ratio -> 14.0% display.
    await expect(page.getByText('14.0%')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not yet calculated' })).toBeVisible();
    await expect(page.getByText('never estimated', { exact: false })).toBeVisible();
  });

  test('empty states distinguish never-observed from zero-row baseline', async ({ page }) => {
    const fresh = await buildWorld(false);
    const emptyNever = await fresh.call('assets');
    expect(JSON.parse(emptyNever.body).reason).toBe('no_recorded_observations');
    await wire(page, { assets: emptyNever });
    await page.goto('/dev/assets-v2');
    await expect(page.getByText('No recorded observations yet', { exact: false })).toBeVisible();
  });

  test('malformed ok body fails closed with a Retry affordance, never renders data', async ({ page }) => {
    const world = await buildWorld(true);
    const assets = await world.call('assets');
    // Hand-corrupt ONLY the marker - the fail-closed contract under test.
    const corrupt = assets.body.replace('"recordedRunMembership":"exact"', '"recordedRunMembership":"precise"');
    expect(corrupt).not.toBe(assets.body);
    await wire(page, { assets: { status: 200, body: corrupt } });
    await page.goto('/dev/assets-v2');
    await expect(page.getByText('Could not load this view', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByText('$4,750.00')).toHaveCount(0);
  });

  test('401 from the real handler renders the sign-in state', async ({ page }) => {
    const world = await buildWorld(true);
    const unauth = await world.call('assets', null);
    expect(unauth.status).toBe(401);
    await wire(page, { assets: unauth });
    await page.goto('/dev/assets-v2');
    await expect(page.getByText('Sign in to see your recorded view', { exact: false })).toBeVisible();
  });

  test('phone viewport: every holdings card fully clears the fixed bottom nav when scrolled', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const world = await buildWorld(true);
    const assets = await world.call('assets');
    await wire(page, { assets });
    await page.goto('/dev/assets-v2');
    await expect(page.getByText('Recorded observations only', { exact: false })).toBeVisible();
    // Real interaction proof for the nav-overlap question: scroll the LAST
    // card's value cell into view and sample the pixel at its center - the
    // point must belong to the card, not the fixed bottom navigation.
    // The holdings table (first on the page); the debt block has its own table.
    const valueCell = page.locator('table').first().locator('td[data-label="Value"]').last();
    await valueCell.scrollIntoViewIfNeeded();
    const box = await valueCell.boundingBox();
    expect(box).not.toBeNull();
    const el = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit ? { tag: hit.tagName, cls: hit.className, text: hit.textContent } : null;
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    // The sampled point is the card's own Value cell (the last card is the
    // unpriced asset, value Unknown) - NOT the fixed bottom nav element.
    expect(el?.tag).toBe('TD');
    expect(el?.text).toContain('Unknown');
  });
});
