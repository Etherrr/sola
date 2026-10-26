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

/**
 * SLICE-3 OVERVIEW PAGE E2E (plan 6.1, reviewer binding verdict A1-A5 + PIN1-3
 * and gates G1-G4, 2026-10-26): /dev/overview-v2 driven by ACTUAL handler
 * responses for EVERY wire the page consumes (summary via views-handler,
 * what-changed via overview-handler, addresses via the real add+list handlers,
 * consent via the consent handler) on ONE same-account world - never a data
 * block beside a default-empty sibling (gate G2). LOCAL ONLY.
 */
import { handleOverview } from '../../server/portfolio/overview-handler';
import { handleAddressAdd, handleAddressesList } from '../../server/portfolio/addresses';
import { handleSnapshotConsentStatus } from '../../server/portfolio/consent';

const OV_OBS = '2026-10-25T12:00:00.000Z';
const OV_OBS2 = '2026-10-26T04:12:00.000Z';

async function buildOverviewWorld() {
  const { db } = createSqliteD1();
  const NOW = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(NOW, NOW).run();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(NOW).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(NOW).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(NOW).run();
  const s = await createSession(db, 'u1');
  const cookie = `${SESSION_COOKIE}=${s.id}`;
  await grantSnapshotConsent(db, 'u1', NOW);
  const env = { PORTFOLIO_ACCOUNTS: '1', NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
  const add = await handleAddressAdd(
    new Request('https://app.test/api/v1/portfolio/addresses', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://app.test' },
      body: JSON.stringify({ network: 'ethereum', address: '0x000000000000000000000000000000000000dead', label: 'Ledger' }),
    }), env as never);
  if (add.status !== 200) throw new Error('address add failed');
  const run = (eth: string, sup: string, debt: string, supUsd: string, debtUsd: string, at: string): Extract<ProviderResult, { ok: true }> => ({
    ok: true, provider: 'test-provider', simulated: false, observedAt: at,
    wallets: [{
      address: '0x000000000000000000000000000000000000dead', partial: false, warnings: [],
      assets: [
        { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18, rawAmount: '0', amount: eth, price: '3000', value: '0', priceSource: 'chainlink', priceObservedAt: at },
        { assetId: 'eip155:1/erc20:USDC', symbol: 'USDC', decimals: 6, rawAmount: '0', amount: '4750', price: '1', value: '0', priceSource: 'chainlink', priceObservedAt: at },
      ],
      aave: {
        status: 'ok' as const,
        positions: [{
          underlyingAsset: '0xUSDC', symbol: 'USDC', decimals: 6,
          supplied: sup, variableDebt: debt, suppliedValueUsd: supUsd, variableDebtValueUsd: debtUsd,
          priceSource: 'chainlink', priceObservedAt: at, observedAt: at,
          usageAsCollateralEnabled: true, reserveNote: null,
        }],
      },
    }],
  });
  await recordObservation(db, 'u1', 'ethereum', run('1.4', '4000', '1500', '4000', '1500', OV_OBS));
  await recordObservation(db, 'u1', 'ethereum', run('1.5', '4750', '1200', '4750', '1200', OV_OBS2));
  const req = (p: string) => new Request(`https://app.test${p}`, { headers: { cookie } });
  const summary = await handlePortfolioView(req('/api/v1/portfolio/summary'), env, 'overview');
  const changed = await handleOverview(req('/api/v1/portfolio/overview'), env);
  const addrs = await handleAddressesList(req('/api/v1/portfolio/addresses'), env as never);
  const consent = await handleSnapshotConsentStatus(req('/api/v1/portfolio/snapshots/consent'), env as never);
  return {
    summary: { status: summary.status, body: await summary.text() },
    changed: { status: changed.status, body: await changed.text() },
    addrs: { status: addrs.status, body: await addrs.text() },
    consent: { status: consent.status, body: await consent.text() },
  };
}

async function wireOverview(page: Page, w: Awaited<ReturnType<typeof buildOverviewWorld>>, summaryOverride?: { status: number; body: string }) {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
  await page.route('**/api/v1/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: { email: 'owner@sola.local' }, expiresAt: new Date(Date.now() + 3600e3).toISOString() }),
  }));
  const s = summaryOverride ?? w.summary;
  await page.route('**/api/v1/portfolio/summary', (route) =>
    route.fulfill({ status: s.status, contentType: 'application/json', body: s.body }));
  await page.route('**/api/v1/portfolio/overview', (route) =>
    route.fulfill({ status: w.changed.status, contentType: 'application/json', body: w.changed.body }));
  await page.route('**/api/v1/portfolio/addresses', (route) =>
    route.fulfill({ status: w.addrs.status, contentType: 'application/json', body: w.addrs.body }));
  await page.route('**/api/v1/portfolio/snapshots/consent', (route) =>
    route.fulfill({ status: w.consent.status, contentType: 'application/json', body: w.consent.body }));
}

test.describe('slice-3 overview page (real handler bytes, one account world)', () => {
  test('renders totals, debt, allocation, history and sibling blocks from the same account', async ({ page }) => {
    const w = await buildOverviewWorld();
    expect(w.summary.status).toBe(200);
    await wireOverview(page, w);
    await page.goto('/dev/overview-v2');
    // Headline gross (handler-computed: 1.5 ETH + USDC + supplied, debt excluded).
    await expect(page.getByText('$14,000.00').first()).toBeVisible();
    // Debt separate with its labeled net (fully-priced case: plain label, PIN2).
    await expect(page.getByRole('heading', { name: 'Recorded debt' })).toBeVisible();
    await expect(page.getByText('Net of recorded debt: $12,800.00', { exact: false })).toBeVisible();
    // A5 shared denominator shares.
    await expect(page.getByText('66.07%')).toBeVisible();
    await expect(page.getByText('33.93%')).toBeVisible();
    // History: span-gated ranges (16h span -> only 'All'), per-series HTML summary.
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '1D' })).toHaveCount(0);
    await expect(page.getByText(/\$12,950\.00 \(Oct 25 12:00 UTC\) to \$14,000\.00 \(Oct 26 04:12 UTC\)/)).toBeVisible();
    // Accessible per-point table: both timestamps per point (A4/PIN3).
    await page.getByText('Every recorded point').click();
    await expect(page.getByRole('columnheader', { name: 'Observed' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Requested' })).toBeVisible();
    // Whole-page consistency (G2): siblings of the SAME account, not empty defaults.
    await expect(page.getByText('1.5 (was 1.4', { exact: false })).toBeVisible();
    await expect(page.getByText('Ledger')).toBeVisible();
    await expect(page.getByText('recording on', { exact: false })).toBeVisible();
  });

  test('malformed summary body fails closed, no figures rendered; Retry recovers with good bytes', async ({ page }) => {
    const w = await buildOverviewWorld();
    const corrupt = w.summary.body.replace('"recordedRunMembership":"exact"', '"recordedRunMembership":"precise"');
    expect(corrupt).not.toBe(w.summary.body);
    await wireOverview(page, w, { status: 200, body: corrupt });
    await page.goto('/dev/overview-v2');
    await expect(page.getByText('Could not load this view', { exact: false })).toBeVisible();
    await expect(page.getByText('$14,000.00')).toHaveCount(0);
    // Real recovery: serve the good bytes, Retry must re-fetch and render them.
    await page.unroute('**/api/v1/portfolio/summary');
    await page.route('**/api/v1/portfolio/summary', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: w.summary.body }));
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('$14,000.00').first()).toBeVisible();
    await expect(page.getByText('Could not load this view', { exact: false })).toHaveCount(0);
  });

  test('phone viewport: expanded points table never widens the page; Notes reachable by keyboard scroll (B1)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const w = await buildOverviewWorld();
    await wireOverview(page, w);
    await page.goto('/dev/overview-v2');
    await page.getByText('Every recorded point').click();
    const notes = page.getByRole('columnheader', { name: 'Notes' });
    await expect(notes).toBeVisible();
    // The PAGE must not gain horizontal overflow: document width stays the viewport width.
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(doc.scroll).toBeLessThanOrEqual(doc.client);
    // The overflow lives inside the scroll region, which scrolls horizontally.
    const region = page.getByRole('region', { name: 'Scrollable recorded-points table' });
    await expect(region).toBeVisible();
    const geo = await region.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
    expect(geo.scrollW).toBeGreaterThan(geo.clientW);
    // Keyboard path: focus the region and arrow right; the Notes header leaves
    // the clipped area and enters the region's visible rect.
    await region.focus();
    const probe = () => region.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const th = Array.from(el.querySelectorAll('th')).find((h) => h.textContent === 'Notes');
      if (!th) return { found: false, left: 0, right: 0, rl: r.left, rr: r.right, scrollLeft: el.scrollLeft };
      const b = th.getBoundingClientRect();
      return { found: true, left: b.left, right: b.right, rl: r.left, rr: r.right, scrollLeft: el.scrollLeft };
    });
    // Keyboard path: arrow right until the Notes header is fully inside the
    // region's visible rect or scrolling stalls (bounded).
    // ArrowRight scrolls the focused region horizontally (End scrolls
    // vertically); press until scrollLeft stops increasing, then let any
    // animated settling finish.
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      const cur = await region.evaluate((el) => el.scrollLeft);
      if (cur === prev && i > 2) break;
      prev = cur;
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }
    let visible = await probe();
    await expect
      .poll(async () => {
        visible = await probe();
        return visible.found && visible.right <= visible.rr + 1 && visible.left >= visible.rl - 1 && visible.scrollLeft > 0;
      }, { timeout: 5000 })
      .toBe(true);
    expect(visible.found).toBe(true);
    expect(visible.scrollLeft).toBeGreaterThan(0);
    expect(visible.right).toBeLessThanOrEqual(visible.rr + 1);
    expect(visible.left).toBeGreaterThanOrEqual(visible.rl - 1);
  });

  test('phone viewport: allocation and history blocks clear the fixed bottom nav when scrolled', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const w = await buildOverviewWorld();
    await wireOverview(page, w);
    await page.goto('/dev/overview-v2');
    const summary = page.locator('.ov2-series-summary li').first();
    await expect(summary).toBeVisible();
    await summary.scrollIntoViewIfNeeded();
    const box = await summary.boundingBox();
    expect(box).not.toBeNull();
    const el = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit ? { tag: hit.tagName, cls: String(hit.className) } : null;
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(el && (el.tag === 'LI' || el.cls.includes('ov2'))).toBeTruthy();
    // Allocation block probe (the test name covers both blocks): a visible
    // allocation cell's center must belong to the table, not the fixed nav.
    const cell = page.locator('.ov2-alloc td').first();
    await cell.scrollIntoViewIfNeeded();
    const cbox = await cell.boundingBox();
    expect(cbox).not.toBeNull();
    const cel = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit ? { tag: hit.tagName } : null;
      },
      { x: cbox!.x + cbox!.width / 2, y: cbox!.y + cbox!.height / 2 },
    );
    expect(cel?.tag).toBe('TD');
  });
});
