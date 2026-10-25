import { test, expect } from '@playwright/test';

// Combined-view proof section on /portfolio: SIMULATED aggregation over invented samples.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
});

test('combined view renders aggregate totals, per-address status and observation window', async ({ page }, info) => {
  await page.goto('/portfolio');
  const section = page.locator('.combined');
  await expect(section.getByRole('heading', { name: 'Saved addresses, combined' })).toBeVisible();
  // Honest framing: simulated aggregation, invented samples, never live.
  await expect(section.getByText('COMBINED VIEW · SIMULATED AGGREGATION')).toBeVisible();
  await expect(section.getByText(/not your wallet, not live data/)).toBeVisible();
  // Combined total: 4500 + 2500 + 750 + 3000 USD = $10,750.00; the unpriced DEMO adds nothing.
  await expect(section.getByText('$10,750.00')).toBeVisible();
  await expect(section.getByText(/Incomplete: 1 unpriced/)).toBeVisible();
  // Observation window: 13:55 - 13:58 UTC (each source's own time).
  await expect(section.getByText('13:55 – 13:58 UTC')).toBeVisible();
  // Per-address rows: labels, networks, statuses, values.
  await expect(section.getByText('Cold wallet')).toBeVisible();
  await expect(section.getByText('Hot wallet')).toBeVisible();
  await expect(section.getByText('Solar')).toBeVisible();
  await expect(section.locator('.badge-ok')).toHaveCount(2);
  await expect(section.locator('.badge-warn')).toHaveCount(1);
  await expect(section.getByText('$7,000.00')).toBeVisible();
  await expect(section.getByText('$750.00')).toBeVisible();
  await expect(section.getByText('+ 1 unknown')).toBeVisible();
  await expect(section.getByText('$3,000.00')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/combined-${info.project.name}.png` });
});
