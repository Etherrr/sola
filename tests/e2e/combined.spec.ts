import { test, expect, type Page } from '@playwright/test';

// Real saved-address combined view on /portfolio, exercised against stubbed same-origin APIs.
// Synthetic fixture addresses only; the stubs read no chain and no real user data.
const ETH1 = '0x' + 'a'.repeat(40);
const ETH2 = '0x' + 'b'.repeat(40);
const SOL1 = 'So1DemoAddr9' + 'z'.repeat(31);
const T1 = '2026-10-25T05:58:00.000Z';
const T2 = '2026-10-25T05:55:00.000Z';

type Row = { network: 'ethereum' | 'solana'; address: string; label: string };
const mkRow = (network: Row['network'], address: string, label: string): Row => ({
  network, address, label,
});
const SEED = [mkRow('ethereum', ETH1, 'Cold wallet'), mkRow('ethereum', ETH2, 'Hot wallet'), mkRow('solana', SOL1, 'Solar')];

const json = (route: import('@playwright/test').Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function stubSession(page: Page) {
  return page.route('**/api/v1/session', (r) =>
    json(r, 200, {
      status: 'ok',
      via: 'cloudflare-access',
      identity: { email: 'jun@example.com' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  );
}

function stubAccounts(page: Page, rows: Row[]) {
  return page.route('**/api/v1/portfolio/accounts', (r) =>
    json(r, 200, { requestId: 'r', accounts: rows.map((a) => ({ ...a, createdAt: T2, updatedAt: T2 })), limits: { maxPerNetwork: 5 } }),
  );
}

const asset = (assetId: string, symbol: string, amount: string, value: string | null) => ({
  assetId, symbol, decimals: 18, amount,
  price: value === null ? null : '1', value,
  priceSource: value === null ? null : 'test-feed',
  priceObservedAt: value === null ? null : T2,
});
const wallet = (address: string, assets: unknown[], partial = false, warnings: string[] = []) => ({
  address, assets, partial, warnings,
});
const resolveBody = (wallets: unknown[], observedAt: string) => ({
  schemaVersion: 1, requestId: 'r', generatedAt: observedAt, observedAt,
  provider: 'test-live', chainId: 1, network: 'ethereum', mode: 'live', simulated: false,
  wallets,
  totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'test' },
  partial: false, warnings: [],
});
const ETH_WALLETS = [
  wallet(ETH1, [asset('eip155:1/native', 'ETH', '1.5', '4500'), asset('eip155:1/erc20:usdc', 'USDC', '2500', '2500')]),
  wallet(ETH2, [asset('eip155:1/native', 'ETH', '0.25', '750'), asset('eip155:1/erc20:demo', 'DEMO', '1000', null)], true, ['One source was unreachable.']),
];
const SOL_WALLETS = [wallet(SOL1, [asset('solana:mainnet/native', 'SOL', '20', '3000')])];

/** Stubs resolve per network; records call counts. `failEthereum` answers 429 for ethereum. */
async function stubResolve(page: Page, opts: { failEthereum?: boolean; failSolana?: boolean } = {}) {
  const calls: string[] = [];
  await page.route('**/api/v1/portfolio/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { network: string; addresses: string[] };
    calls.push(body.network);
    if (body.network === 'ethereum') {
      if (opts.failEthereum)
        return json(route, 429, { error: { code: 'rate_limited', message: 'limited' }, requestId: 'r' });
      return json(route, 200, { ...resolveBody(ETH_WALLETS, T2), network: 'ethereum' });
    }
    if (opts.failSolana)
      return json(route, 429, { error: { code: 'rate_limited', message: 'limited' }, requestId: 'r' });
    return json(route, 200, { ...resolveBody(SOL_WALLETS, T1), network: 'solana', chainId: null });
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubSession(page);
});

test('loads nothing until asked, then renders the real combined view with per-address honesty', async ({ page }, info) => {
  await stubAccounts(page, SEED);
  const calls = await stubResolve(page);
  await page.goto('/portfolio');
  // Scope to #main: during Next.js streaming the prerendered segment sits briefly in a
  // hidden sibling container (#S:0) outside #main; scoping removes that transient.
  const section = page.locator('#main .combined');
  await expect(section.getByRole('heading', { name: 'Saved addresses, combined' })).toBeVisible();
  // Page-level framing is honest about mixed modes: no page-wide simulated claim over a live
  // section; the fixture keeps its own SIMULATED marker below.
  await expect(page.locator('.sim-pill')).toContainText('MODE SHOWN PER SECTION');
  await expect(
    page.locator('#main').getByText(/Combine the public addresses saved on your account/),
  ).toBeVisible();
  const marker = page.locator('#main .mode-marker');
  await expect(marker).toContainText('SIMULATED');
  // The fixture's marker sits BELOW the combined section, scoping the claim to the fixture.
  const markerAfterCombined = await page.evaluate(
    () =>
      document
        .querySelector('#main .combined')!
        .compareDocumentPosition(document.querySelector('#main .mode-marker')!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(markerAfterCombined).toBeTruthy();
  // Idle: honest read-only framing, explicit action, and no automatic fetch.
  await expect(section.getByText('COMBINED VIEW · READ-ONLY')).toBeVisible();
  await expect(section.getByText(/Nothing loads automatically/)).toBeVisible();
  expect(calls).toEqual([]);
  await page.screenshot({ path: `test-results/combined-idle-${info.project.name}.png` });
  // Viewport-true header frame (no scroll): the pill and account control must fit with no
  // horizontal offset, and no network chip claims page scope it does not have.
  await expect(page.locator('.scope-chip')).toHaveCount(0);
  await page.screenshot({ path: `test-results/combined-header-${info.project.name}.png` });
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  // One resolve call per network, not per address.
  await expect(section.getByText('$10,750.00')).toBeVisible();
  expect(calls.sort()).toEqual(['ethereum', 'solana']);
  // Loaded: live badge, per-address rows with statuses, values and source times.
  await expect(section.getByText('COMBINED VIEW · LIVE READ-ONLY')).toBeVisible();
  await expect(section.locator('summary', { hasText: 'Cold wallet' })).toBeVisible();
  await expect(section.locator('summary', { hasText: 'Hot wallet' })).toBeVisible();
  await expect(section.locator('summary', { hasText: 'Solar' })).toBeVisible();
  await expect(section.locator('.badge-loaded')).toHaveCount(2);
  await expect(section.locator('.badge-warn')).toHaveCount(1);
  await expect(section.getByText('$7,000.00')).toBeVisible();
  await expect(section.getByText('$750.00')).toBeVisible();
  await expect(section.getByText('+ 1 unknown')).toBeVisible();
  await expect(section.getByText('$3,000.00')).toBeVisible();
  await expect(section.getByText(/Incomplete: 1 unpriced/)).toBeVisible();
  await expect(section.getByText('3 of 3')).toBeVisible();
  await expect(section.getByText('05:55 – 05:58 UTC')).toBeVisible();
  await expect(section.getByText(/One source was unreachable/)).toBeVisible();
  await expect(section.getByText(/Coverage: Ethereum ETH plus USDC, USDT, DAI and WETH/)).toBeVisible();
  await expect(section.getByText(/not a zero balance/)).toBeVisible();
  await expect(section.getByText(/observed, not proven to be yours/)).toBeVisible();
  await expect(section.getByText(/Refreshes only when you ask/)).toBeVisible();
  await expect(section.getByText(/Sources: test-live via the read-only API/)).toBeVisible();
  await expect(section.getByText(/request time, not an observation time/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Refresh now' })).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/combined-${info.project.name}.png` });
  if (info.project.name === 'mobile') {
    await section
      .locator('.combined-table-wrap')
      .screenshot({ path: 'test-results/combined-cards-mobile.png' });
    await page.screenshot({ path: 'test-results/combined-loaded-viewport-mobile.png' });
  }
});

test('empty saved list shows the honest empty state with a path to Track', async ({ page }) => {
  await stubAccounts(page, []);
  const calls = await stubResolve(page);
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.getByText(/No saved addresses yet/)).toBeVisible();
  await expect(section.getByRole('link', { name: 'Track' })).toBeVisible();
  expect(calls).toEqual([]); // no lookups when there is nothing to look up
});

test('a failed network marks only its own addresses failed; nothing is substituted', async ({ page }, info) => {
  await stubAccounts(page, SEED);
  await stubResolve(page, { failEthereum: true });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.locator('.metric strong').first()).toHaveText('$3,000.00'); // solana still counts
  await expect(section.getByRole('cell', { name: '$3,000.00' })).toBeVisible();
  await expect(section.getByText('1 of 3')).toBeVisible();
  await expect(section.locator('.badge-warn')).toHaveCount(2); // both ethereum addresses FAILED
  await expect(section.getByText('FAILED').first()).toBeVisible();
  await expect(section.getByText(/data source is busy/i).first()).toBeVisible();
  await expect(section.getByText(/Incomplete: 0 unpriced/)).toBeVisible();
  await expect(section.getByText('05:58 – 05:58 UTC')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/combined-failed-${info.project.name}.png` });
});

test('when every network fails the badge claims no data mode', async ({ page }) => {
  await stubAccounts(page, SEED);
  await stubResolve(page, { failEthereum: true, failSolana: true });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.getByText('COMBINED VIEW · READ-ONLY')).toBeVisible();
  await expect(section.getByText('COMBINED VIEW · SIMULATED')).toHaveCount(0);
  await expect(section.getByText('COMBINED VIEW · LIVE READ-ONLY')).toHaveCount(0);
  await expect(section.locator('.badge-warn')).toHaveCount(3);
  await expect(section.getByText('0 of 3')).toBeVisible();
  await expect(section.locator('.metric strong').first()).toHaveText('n/a'); // never $0.00 when nothing was read
});

test('an unverified session never fetches and says so', async ({ page }) => {
  await page.unroute('**/api/v1/session');
  await page.route('**/api/v1/session', (r) => json(r, 401, { error: { code: 'unauthorized' } }));
  await stubAccounts(page, SEED);
  const calls = await stubResolve(page);
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await expect(section.getByText(/Your sign-in could not be verified/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Load saved addresses, combined' })).toHaveCount(0);
  expect(calls).toEqual([]);
});
