import { expect, test, type Page } from '@playwright/test';

/**
 * The gated native account page, desktop + mobile. APIs intercepted with
 * contract-faithful stand-ins (real handlers: tests/portfolio-addresses.test.ts
 * + live staging probes). Proves: no session -> redirect to sign-in with a
 * validated resume destination; signed-in but NOT invited -> honest state,
 * never empty holdings; invited -> the account renders; the full door ->
 * sign-in -> account path lands.
 */

const SESS = '**/api/v1/auth/email/session';
const ADDR = '**/api/v1/portfolio/addresses';

async function mockSession(page: Page, mode: 'none' | 'ok') {
  await page.route(SESS, (r) =>
    mode === 'none'
      ? r.fulfill({ status: 401, json: { error: 'auth_required' } })
      : r.fulfill({ status: 200, json: { status: 'ok', email: 'jun@example.com', fresh: true } }),
  );
}

test('no session redirects to sign-in carrying the resume destination', async ({ page }) => {
  await mockSession(page, 'none');
  await page.goto('/account/');
  await expect(page).toHaveURL(/\/sign-in\/\?next=%2Faccount/);
  await expect(page.getByLabel(/email you were invited with/i)).toBeVisible();
});

test('signed in but not invited: honest state, never empty holdings', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 403, json: { error: 'not_entitled' } }));
  await page.goto('/account/');
  await expect(page.getByRole('heading', { name: 'Not invited yet' })).toBeVisible();
  await expect(page.getByText('does not have preview access')).toBeVisible();
  await expect(page.getByText('Signed in as jun@example.com')).toBeVisible();
});

test('invited session renders the account and sign-out control', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.goto('/account/');
  await expect(page.getByText('Signed in as jun@example.com.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('full path: sign-in ceremony resumes into the gated account', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/challenge', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', expiresAt: '2026-10-25T20:00:00Z' } }),
  );
  await page.route('**/api/v1/auth/email/verify', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', user: { id: 'u-fixture' } } }),
  );
  await page.goto('/sign-in/?next=%2Faccount');
  await page.getByLabel(/email you were invited with/i).fill('jun@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/email code/i).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const cont = page.getByRole('link', { name: 'Continue' });
  await expect(cont).toHaveAttribute('href', '/account');
  await cont.click();
  await expect(page.getByText('Signed in as jun@example.com.')).toBeVisible();
});

test('failed sign-out keeps the truth visible - no fake signed-out navigation', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/logout', (r) => r.fulfill({ status: 500, json: { error: 'x' } }));
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});

test('a 403 that is not not_entitled shows the honest error, not "not invited"', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 403, json: { error: 'forbidden_origin' } }));
  await page.goto('/account/');
  await expect(page.getByText('could not be read just now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not invited yet' })).toHaveCount(0);
});

test('stale session (data 401 after session ok) asks for a fresh sign-in, no redirect loop', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 401, json: { error: 'auth_required' } }));
  await page.goto('/account/');
  await expect(page.getByText('This session went stale. Sign in again to continue.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in/?next=%2Faccount');
});

test('sign-out with a dead network keeps you signed in and honest - no fake navigation', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.goto('/account/');
  await page.route('**/api/v1/auth/email/logout', (r) => r.abort('timedout'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});

test('header menu sign-out failure alerts and keeps you signed in - no fake reload', async ({ page }) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  await page.route('**/api/v1/auth/email/logout', (r) => r.fulfill({ status: 500, json: { error: 'x' } }));
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Account: jun@example.com' }).click();
  await page.getByRole('group', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('group', { name: 'Account' }).locator('p[role=alert]')).toContainText('Could not sign out');
  await expect(page).toHaveURL(/\/account\//);
});

test('the native combined view reads the native book only: empty book, zero provider resolve', async ({
  page,
}) => {
  await mockSession(page, 'ok');
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: [] } }));
  let legacy = 0;
  let resolve = 0;
  await page.route('**/api/v1/portfolio/accounts', (r) => {
    legacy++;
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route('**/api/v1/portfolio/resolve', (r) => {
    resolve++;
    return r.fulfill({ status: 500, json: {} });
  });
  await page.goto('/account/');
  await expect(page.getByRole('heading', { name: 'All saved addresses' })).toBeVisible();
  await expect(page.getByText(/wallet balances only/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(page.getByText(/No saved addresses yet/)).toBeVisible();
  // An empty native book never touches a provider, and the legacy Access store
  // is never read on this page.
  expect(resolve).toBe(0);
  expect(legacy).toBe(0);
});

test('non-empty native book: one click loads combined balances through the native book', async ({
  page,
}) => {
  await mockSession(page, 'ok');
  const eth = '0x' + 'a'.repeat(40);
  const sol = 'So1DemoAddr9' + 'z'.repeat(31);
  const rows = [
    { network: 'ethereum', address: eth, label: 'Cold wallet', verification: 'watched', createdAt: '2026-10-25T00:00:00Z', lastObservedAt: null },
    { network: 'solana', address: sol, label: 'Solar', verification: 'watched', createdAt: '2026-10-25T00:00:00Z', lastObservedAt: null },
  ];
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: rows } }));
  let legacy = 0;
  await page.route('**/api/v1/portfolio/accounts', (r) => {
    legacy++;
    return r.fulfill({ status: 500, json: {} });
  });
  const seen: { network: string; addresses: string[] }[] = [];
  await page.route('**/api/v1/portfolio/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { network: string; addresses: string[] };
    seen.push(body);
    const isEth = body.network === 'ethereum';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1, requestId: 'r',
        generatedAt: '2026-10-25T05:58:00Z', observedAt: '2026-10-25T05:58:00Z',
        provider: 'test-live', chainId: isEth ? 1 : null, network: body.network,
        mode: 'live', simulated: false,
        wallets: [{
          address: body.addresses[0],
          assets: [{
            assetId: isEth ? 'eip155:1/native' : 'solana:mainnet/native',
            symbol: isEth ? 'ETH' : 'SOL', decimals: 18,
            amount: isEth ? '1.5' : '20', price: '1', value: isEth ? '4500' : '3000',
            priceSource: 'test-feed', priceObservedAt: '2026-10-25T05:55:00Z',
          }],
          partial: false, warnings: [],
        }],
        totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'test' },
        partial: false, warnings: [],
      }),
    });
  });
  await page.goto('/account/');
  await expect(page.getByRole('heading', { name: 'All saved addresses' })).toBeVisible();
  await page.getByRole('button', { name: 'Load combined balances' }).click();
  // 4500 + 3000 across two networks, from the NATIVE book's own addresses.
  await expect(page.getByText('$7,500.00').first()).toBeVisible();
  await expect(page.getByText(/wallet balances only/i).first()).toBeVisible();
  expect(seen.map((x) => x.network).sort()).toEqual(['ethereum', 'solana']);
  expect(seen.find((x) => x.network === 'ethereum')?.addresses).toEqual([eth]);
  expect(seen.find((x) => x.network === 'solana')?.addresses).toEqual([sol]);
  expect(legacy).toBe(0);
});

// Aave V3 Phase 1 on the NATIVE combined view (fixture-only): a flag-on resolve answer carries
// one aave section per wallet; the native /account surface renders it per address, separately,
// and never adds it to the combined total. No chain is read.
test('native combined view renders aave per address, separately, never added to the total', async ({
  page,
}) => {
  await mockSession(page, 'ok');
  const eth = '0x' + 'a'.repeat(40);
  const rows = [
    { network: 'ethereum', address: eth, label: 'Cold wallet', verification: 'watched', createdAt: '2026-10-25T00:00:00Z', lastObservedAt: null },
  ];
  await page.route(ADDR, (r) => r.fulfill({ status: 200, json: { status: 'ok', addresses: rows } }));
  await page.route('**/api/v1/portfolio/resolve', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1, requestId: 'r',
        generatedAt: '2026-10-25T05:58:00Z', observedAt: '2026-10-25T05:58:00Z',
        provider: 'test-live', chainId: 1, network: 'ethereum',
        mode: 'live', simulated: false,
        wallets: [{
          address: eth,
          assets: [{
            assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
            amount: '1.5', price: '1', value: '4500',
            priceSource: 'test-feed', priceObservedAt: '2026-10-25T05:55:00Z',
          }],
          partial: false, warnings: [],
          aave: {
            status: 'ok',
            positions: [{
              underlyingAsset: '0x' + 'c'.repeat(40), symbol: 'USDC', decimals: 6,
              supplied: '11392.069003', variableDebt: '0',
              suppliedValueUsd: '11390.54', variableDebtValueUsd: '0',
              priceSource: 'chainlink:USDC/USD', priceObservedAt: '2026-10-23T11:58:00Z',
              observedAt: '2026-10-23T11:58:00Z',
              usageAsCollateralEnabled: true, reserveNote: null,
            }],
          },
        }],
        totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'test' },
        partial: false, warnings: [],
      }),
    }),
  );
  await page.goto('/account/');
  await expect(page.getByRole('heading', { name: 'All saved addresses' })).toBeVisible();
  await page.getByRole('button', { name: 'Load combined balances' }).click();
  // Total stays the wallet balance only: $4,500.00; the $11,390.54 supplied position never enters it.
  await expect(page.getByText('$4,500.00').first()).toBeVisible();
  await expect(
    page.getByText(/Aave V3 positions listed separately - never added to this total/),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aave V3 positions (Ethereum)' })).toBeVisible();
  await expect(page.locator('.combined-aave').getByText('Cold wallet')).toBeVisible();
  await expect(page.locator('.aave-table').getByText('USDC')).toBeVisible();
  await expect(page.getByText('Scroll sideways for debt and observed time.')).toBeAttached();
});
