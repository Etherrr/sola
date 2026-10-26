import { test, expect } from '@playwright/test';

/**
 * Overview Portfolio panel same-page invalidation (2026-10-26 defect: after an
 * in-page Refresh the top card kept its mount-time "No recorded observations
 * yet" copy while What changed updated; reload rendered correctly). These
 * specs pin the fix: OverviewView subscribes to the shared
 * 'sola:observation-synced' event exactly like what-changed.tsx. Synthetic
 * bodies only - the recorded zero-holdings shape mirrors the actual wire
 * verified on staging 2026-10-26 (reason no_holdings_recorded + $0 history).
 */

const SESSION = {
  status: 'ok',
  email: 'owner@example.com',
  fresh: true,
};

const NO_RECORDS = JSON.stringify({
  status: 'empty',
  reason: 'no_recorded_observations',
  newerPartial: false,
  newerUnattributed: false,
});

const ZERO_POINT = {
  runId: 'run-1',
  requestedAt: '2026-10-26T14:25:49.606Z',
  observedAt: '2026-10-26T14:25:49.574Z',
  pricedSubtotalUsd: '0',
  unpricedCount: 0,
  staleCount: 0,
  legacy: false,
};

const ZERO_HOLDINGS = JSON.stringify({
  status: 'empty',
  reason: 'no_holdings_recorded',
  newerPartial: false,
  newerUnattributed: false,
  latestCompleteObservedAt: '2026-10-26T14:25:49.796Z',
  recordedRunMembership: 'exact',
  networks: [{ network: 'ethereum', latestObservedAt: '2026-10-26T14:25:49.574Z' }],
  history: [{ network: 'ethereum', points: [ZERO_POINT] }],
});

const NO_RECORDS_COPY = /No recorded observations yet/;
const ZERO_COPY = /latest complete observation recorded no holdings/;

async function stubSession(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }),
  );
}

test('v2 overview: a recorded event repaints the Portfolio panel without reload', async ({ page }) => {
  await stubSession(page);
  let calls = 0;
  await page.route('**/api/v1/portfolio/summary**', (r) => {
    calls += 1;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: calls === 1 ? NO_RECORDS : ZERO_HOLDINGS,
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(main.getByText(NO_RECORDS_COPY)).toBeVisible();
  await expect(main.getByText(ZERO_COPY)).toHaveCount(0);

  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced', { detail: { reason: 'recorded' } })),
  );

  await expect(main.getByText(ZERO_COPY)).toBeVisible();
  await expect(main.getByText(NO_RECORDS_COPY)).toHaveCount(0);
  await expect(main.getByRole('img', { name: /Recorded priced value in USD over time/ })).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);
});

test('v2 overview: a withdraw event clears recorded figures at once, never lingers deleted history', async ({ page }) => {
  await stubSession(page);
  let calls = 0;
  await page.route('**/api/v1/portfolio/summary**', (r) => {
    calls += 1;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: calls === 1 ? ZERO_HOLDINGS : NO_RECORDS,
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(main.getByText(ZERO_COPY)).toBeVisible();
  await expect(main.getByText('$0.00').first()).toBeVisible();

  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced', { detail: { reason: 'withdraw' } })),
  );

  // Clears to loading immediately rather than showing deleted figures.
  await expect(main.getByText(NO_RECORDS_COPY)).toBeVisible();
  await expect(main.getByText(ZERO_COPY)).toHaveCount(0);
  await expect(main.getByText('$0.00')).toHaveCount(0);
});

test('v2 overview: a pre-withdraw in-flight response cannot paint deleted figures', async ({ page }) => {
  await stubSession(page);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  await page.route('**/api/v1/portfolio/summary**', async (r) => {
    calls += 1;
    if (calls === 1) {
      await gate;
      return r.fulfill({ status: 200, contentType: 'application/json', body: ZERO_HOLDINGS });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: NO_RECORDS });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(main.getByText('Loading recorded overview…')).toBeVisible();

  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced', { detail: { reason: 'withdraw' } })),
  );
  await expect(main.getByText(NO_RECORDS_COPY)).toBeVisible();

  // The stale mount response now resolves; the gen guard must discard it.
  release();
  await page.waitForTimeout(500);
  await expect(main.getByText(NO_RECORDS_COPY)).toBeVisible();
  await expect(main.getByText(ZERO_COPY)).toHaveCount(0);
});
