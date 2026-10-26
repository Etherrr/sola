import { test, expect, type Page } from '@playwright/test';
import { evmCoverageLabel, SUPPORTED_EVM_SYMBOLS } from '../../lib/supported-evm-tokens';

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

const SOL_UNREAD = [
  wallet(SOL1, [], true, ['SOL balance could not be read; this is not a zero balance.']),
];

/** Stubs resolve per network; records call counts. `failEthereum` answers 429 for ethereum.
 *  `ethWallets`/`solWallets` override the answered wallets (e.g. an unread or true-zero one). */
async function stubResolve(
  page: Page,
  opts: {
    failEthereum?: boolean;
    failSolana?: boolean;
    ethWallets?: unknown[];
    solWallets?: unknown[];
    ethAt?: string;
    solAt?: string;
  } = {},
) {
  const calls: string[] = [];
  await page.route('**/api/v1/portfolio/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { network: string; addresses: string[] };
    calls.push(body.network);
    if (body.network === 'ethereum') {
      if (opts.failEthereum)
        return json(route, 429, { error: { code: 'rate_limited', message: 'limited' }, requestId: 'r' });
      return json(route, 200, { ...resolveBody(opts.ethWallets ?? ETH_WALLETS, opts.ethAt ?? T2), network: 'ethereum' });
    }
    if (opts.failSolana)
      return json(route, 429, { error: { code: 'rate_limited', message: 'limited' }, requestId: 'r' });
    return json(route, 200, { ...resolveBody(opts.solWallets ?? SOL_WALLETS, opts.solAt ?? T1), network: 'solana', chainId: null });
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
  // Page-level framing is honest: no page-wide simulated claim over a live
  // section, and no demo fixture on this page at all - it moved to /demo.
  await expect(page.locator('.sim-pill')).toContainText('MODE SHOWN PER SECTION');
  await expect(
    page.locator('#main').getByText(/This page keeps the older Track address list/),
  ).toBeVisible();
  await expect(page.locator('#main .mode-marker')).toHaveCount(0);
  // Idle: honest read-only framing, explicit action, and no automatic fetch.
  await expect(section.getByText('COMBINED VIEW · READ-ONLY')).toBeVisible();
  await expect(section.getByText(/loaded only when you ask/)).toBeVisible();
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
  // Compact badges visible; the full honesty notes live one tap away in the details panel.
  await expect(section.getByText(`Ethereum: ${SUPPORTED_EVM_SYMBOLS.join(', ')}`)).toBeVisible();
  await expect(section.getByText('Solana: SOL balance only')).toBeVisible();
  await expect(section.getByText('Observed, not owned')).toBeVisible();
  const covRe = new RegExp(`Coverage: Ethereum ${evmCoverageLabel().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  await expect(section.getByText(covRe)).toHaveCount(1);
  await section.locator('.cov-details summary').click();
  await expect(section.getByText(covRe)).toBeVisible();
  await expect(section.getByText(/not a zero balance/)).toBeVisible();
  await expect(section.getByText(/Refreshes only when you ask/)).toBeVisible();
  await expect(section.getByText(/Sources: test-live via the read-only API/)).toBeVisible();
  await expect(section.getByText(/Prices Oct 25, 2026 · 05:55 UTC/)).toBeVisible();
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
  // A single shared instant collapses to one time - no misleading "x – x" range.
  await expect(section.getByText(/· 05:58 UTC$/)).toBeVisible();
  await expect(section.getByText('05:58 – 05:58 UTC')).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/combined-failed-${info.project.name}.png` });
});

test('same-minute reads with differing milliseconds collapse to one time label', async ({ page }) => {
  await stubAccounts(page, SEED);
  await stubResolve(page, { ethAt: '2026-10-25T05:58:17.875Z', solAt: '2026-10-25T05:58:58.082Z' });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.locator('.metric strong').first()).toHaveText('$10,750.00');
  // Both networks read inside 05:58 - one time, never a '05:58 – 05:58' duplicate.
  await expect(section.getByText(/· 05:58 UTC$/)).toBeVisible();
  await expect(section.getByText(/05:58 – 05:58/)).toHaveCount(0);
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

test('a sole partial answer with an unread balance is n/a, never $0.00', async ({ page }) => {
  // The warning says "not a zero balance"; the row and the combined total must agree.
  await stubAccounts(page, [mkRow('solana', SOL1, 'Solar')]);
  await stubResolve(page, { solWallets: SOL_UNREAD });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.getByText('COMBINED VIEW · LIVE READ-ONLY')).toBeVisible(); // a real answer contributed
  await expect(section.locator('.metric strong').first()).toHaveText('n/a'); // never $0.00 for an unread balance
  await expect(section.getByText('0 of 1')).toBeVisible();
  await expect(section.locator('.badge-warn', { hasText: 'PARTIAL' })).toBeVisible();
  const row = section.locator('tr', { hasText: 'Solar' });
  await expect(row.getByRole('cell', { name: 'n/a' }).first()).toBeVisible();
  await expect(row.getByText('$0.00')).toHaveCount(0);
  await expect(section.getByText(/not a zero balance/).first()).toBeVisible();
  await expect(section.getByText(/Incomplete: 0 unpriced/)).toBeVisible();
});

test('a known ETH subtotal stands while an unread SOL row is n/a', async ({ page }) => {
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet'), mkRow('solana', SOL1, 'Solar')]);
  await stubResolve(page, { ethWallets: [ETH_WALLETS[0]], solWallets: SOL_UNREAD });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.locator('.metric strong').first()).toHaveText('$7,000.00'); // known subtotal stands
  await expect(section.getByText(/Incomplete: 0 unpriced assets, 1 address partial or failed/)).toBeVisible();
  const solRow = section.locator('tr', { hasText: 'Solar' });
  await expect(solRow.getByRole('cell', { name: 'n/a' }).first()).toBeVisible();
  await expect(solRow.getByText('$0.00')).toHaveCount(0);
  const ethRow = section.locator('tr', { hasText: 'Cold wallet' });
  await expect(ethRow.getByRole('cell', { name: '$7,000.00' })).toBeVisible();
  await expect(section.getByText('1 of 2')).toBeVisible();
});

test('a wallet actually read as zero keeps its true $0.00', async ({ page }) => {
  const zeroWallets = [
    wallet(ETH1, [asset('eip155:1/native', 'ETH', '0', '0'), asset('eip155:1/erc20:usdc', 'USDC', '0', '0')]),
  ];
  await stubAccounts(page, [mkRow('ethereum', ETH1, 'Cold wallet')]);
  await stubResolve(page, { ethWallets: zeroWallets });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.locator('.metric strong').first()).toHaveText('$0.00'); // true zero, fully read
  await expect(section.getByText('1 of 1')).toBeVisible();
  await expect(section.locator('.badge-loaded')).toHaveCount(1);
  await expect(section.getByText(/Incomplete:/)).toHaveCount(0);
  const row = section.locator('tr', { hasText: 'Cold wallet' });
  await expect(row.getByRole('cell', { name: '$0.00' })).toBeVisible();
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

test('the /portfolio overview carries no demo fixture - the invented sample lives under /demo', async ({
  page,
}) => {
  await stubSession(page);
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Legacy Track list' })).toBeVisible();
  await expect(page.locator('#main')).not.toContainText('$12,000');
  await expect(page.locator('#main')).not.toContainText('SIMULATED');
  await expect(page.getByText(/older Track address list/).first()).toBeVisible();
  await page.goto('/demo');
  await expect(page.locator('#main')).toContainText('$11,000.00');
  await expect(page.locator('#main .mode-marker')).toContainText('SIMULATED');
});

test('a native signed-in user on /portfolio gets a visible pointer to the account book', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    json(r, 200, { status: 'ok', email: 'jun@example.com', fresh: true }),
  );
  await page.goto('/portfolio');
  const pointer = page.getByText(/your address book and its combined view live on/);
  await expect(pointer).toBeVisible();
  await expect(pointer.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account/');
});

test('a signed-out visitor on /portfolio gets no account pointer and no account read', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 401, json: { error: 'auth_required' } }),
  );
  let nativeBookReads = 0;
  await page.route('**/api/v1/portfolio/addresses', (r) => {
    nativeBookReads++;
    return r.fulfill({ status: 401, json: { error: 'auth_required' } });
  });
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Legacy Track list' })).toBeVisible();
  await expect(page.getByText(/your address book and its combined view live on/)).toHaveCount(0);
  expect(nativeBookReads).toBe(0);
});

// Aave V3 Phase 1 (fixture-only): the server includes aave sections only when its flag is
// on; the combined view must render them per address, separately, and never add them to
// any total. Stubs below stand in for flag-on answers; no chain is read.
const AAVE_OK = {
  status: 'ok',
  positions: [
    {
      underlyingAsset: '0x' + 'c'.repeat(40),
      symbol: 'USDC',
      decimals: 6,
      supplied: '11392.069003',
      variableDebt: '0',
      suppliedValueUsd: '11390.54',
      variableDebtValueUsd: '0',
      priceSource: 'chainlink:USDC/USD',
      priceObservedAt: '2026-10-23T11:58:00Z',
      observedAt: '2026-10-23T11:58:00Z',
      usageAsCollateralEnabled: true,
      reserveNote: null,
    },
  ],
};
const walletWithAave = (w: Record<string, unknown>, aave: unknown) => ({ ...w, aave });

test('aave sections render per address, separately, and never enter the combined total', async ({ page }, info) => {
  await stubAccounts(page, SEED);
  await stubResolve(page, {
    ethWallets: [walletWithAave(ETH_WALLETS[0] as Record<string, unknown>, AAVE_OK), ETH_WALLETS[1]],
  });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  // Combined total unchanged by Aave: ETH1 4500+2500, ETH2 750, SOL 3000 = $10,750.00.
  await expect(section.getByText('$10,750.00')).toBeVisible();
  await expect(
    section.getByText(/Aave V3 positions are listed separately below and are never added to this total/),
  ).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Aave V3 positions (Ethereum)' })).toBeVisible();
  await expect(section.locator('.combined-aave').getByText('Cold wallet')).toBeVisible();
  await expect(section.locator('.aave-table').getByText('USDC')).toBeVisible();
  // Only the flagged address carries a section; the other two do not.
  await expect(section.getByRole('heading', { name: 'Aave V3 positions (Ethereum)' })).toHaveCount(1);
  // Mobile usability: the pan affordance is offered and every column is reachable by panning.
  const hint = section.getByText('Scroll sideways for debt and observed time.');
  await expect(hint).toBeAttached();
  if (info.project.name === 'mobile') {
    await expect(hint).toBeVisible();
    const scroller = section.locator('.aave-scroll');
    await scroller.scrollIntoViewIfNeeded();
    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    // The rightmost columns (debt, observed time) sit outside the initial phone viewport and
    // must be reachable by panning the scroll region.
    await expect(section.locator('.aave-table th', { hasText: 'Variable debt' }).first()).toBeInViewport();
    await expect(section.locator('.aave-table th', { hasText: 'Observed' }).first()).toBeInViewport();
  }
});

test('an unavailable aave section says nothing was substituted and changes no total', async ({ page }) => {
  await stubAccounts(page, SEED);
  await stubResolve(page, {
    ethWallets: [
      walletWithAave(ETH_WALLETS[0] as Record<string, unknown>, {
        status: 'unavailable',
        reason: 'rate_limited',
      }),
      ETH_WALLETS[1],
    ],
  });
  await page.goto('/portfolio');
  const section = page.locator('#main .combined');
  await section.getByRole('button', { name: 'Load saved addresses, combined' }).click();
  await expect(section.getByText('$10,750.00')).toBeVisible();
  await expect(
    section.getByText(/Aave positions could not be read\. Nothing was substituted\./),
  ).toBeVisible();
  await expect(section.locator('.aave-table')).toHaveCount(0);
});
