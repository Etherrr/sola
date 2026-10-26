// Synthetic-fixture capture of the populated v2 Overview (address manager +
// lookup tool). NOT a live session: every API is mocked with fixture data,
// served from the local static build. Output is emulated-viewport evidence.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const EVM = '0xAbC1230000000000000000000000000000000000';
const SOL = 'So11111111111111111111111111111111111111112';
const row = (network, address, assetId, amount, at) => ({
  assetId, network, address, kind: 'wallet_balance', amount, observedAt: at,
});
const LATEST_AT = '2026-10-25T01:00:00Z';
const PRIOR_AT = '2026-10-24T01:00:00Z';
const evmLatest = [row('ethereum', EVM.toLowerCase(), 'eip155:1/native', '1.5', LATEST_AT),
  row('ethereum', EVM.toLowerCase(), 'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '250', LATEST_AT)];
const evmPrior = [row('ethereum', EVM.toLowerCase(), 'eip155:1/native', '1.2', PRIOR_AT),
  row('ethereum', EVM.toLowerCase(), 'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '250', PRIOR_AT)];
const solLatest = [row('solana', SOL, 'solana:mainnet/native', '12.3', LATEST_AT)];
const solPrior = [row('solana', SOL, 'solana:mainnet/native', '10.0', PRIOR_AT)];

const server = spawn('npm', ['run', 'start'], { stdio: 'ignore' });
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:3000/dev/overview-v2/');
      if (r.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
};
await waitUp();

const browser = await chromium.launch();
// Tall viewports fit the whole populated page so a viewport (not fullPage)
// shot shows everything without sticky-header duplication.
for (const vp of [
  { label: 'desktop', width: 1280, height: 2500 },
  { label: 'mobile', width: 390, height: 2750, isMobile: true, hasTouch: true },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    isMobile: vp.isMobile ?? false,
    hasTouch: vp.hasTouch ?? false,
  });
  const page = await ctx.newPage();
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }) }));
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [
        { network: 'ethereum', address: EVM, label: 'Main', verification: 'watched',
          createdAt: '2026-10-24T00:00:00Z', lastObservedAt: LATEST_AT },
        { network: 'solana', address: SOL, label: 'Vault', verification: 'verified',
          createdAt: '2026-10-24T00:00:00Z', lastObservedAt: LATEST_AT },
      ] }) });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok', scope: 'spot_balances_only',
        latestCompleteObservedAt: LATEST_AT, newerPartial: false,
        latest: [...evmLatest, ...solLatest], prior: [...evmPrior, ...solPrior],
        networks: [
          { network: 'ethereum', latestObservedAt: LATEST_AT, latest: evmLatest, prior: evmPrior },
          { network: 'solana', latestObservedAt: LATEST_AT, latest: solLatest, prior: solPrior },
        ],
      }) }));
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1, mode: 'mock', simulated: true, provider: 'fixture',
        generatedAt: LATEST_AT, observedAt: LATEST_AT,
        wallets: [{ address: EVM.toLowerCase(), partial: false, warnings: [], assets: [
          { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18, amount: '1.5', price: '3000', value: '4500' },
          { assetId: 'eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, amount: '250', price: '1', value: '250' },
        ] }],
        totals: { recognizedPricedSubtotalUsd: '4750', unpricedAssetCount: 0, note: 'Subtotal covers only assets priced by verified feeds.' },
        partial: false, warnings: [],
      }) }));
  await page.goto('http://127.0.0.1:3000/dev/overview-v2/');
  await page.getByRole('cell', { name: 'ETH' }).first().waitFor();
  // Expand the first address's Details and run a lookup, so one frame shows both.
  await page.getByRole('button', { name: /Details for Main/ }).click();
  await page.locator('.ab-details').getByRole('cell', { name: '0xA0b8\u2026eB48' }).waitFor();
  await page.getByLabel('Address to look up').fill(EVM);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await page.locator('.ab-lookup').getByRole('cell', { name: 'USDC' }).waitFor();
  // Reset scroll positions the interactions changed (click auto-scrolls the
  // horizontally scrollable address table) so the capture shows rest state.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('.ab-scroll').forEach((el) => { el.scrollLeft = 0; });
  });
  await page.screenshot({ path: `/downloads/v2-populated-${vp.label}-dark.png` });
  // Section captures at a normal viewport, ordinary full-viewport shots
  // scrolled so each section starts near the top: no line is cut mid-glyph
  // by an element boundary (main 2026-10-25).
  await page.setViewportSize({ width: vp.width, height: vp.label === 'mobile' ? 844 : 720 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('.ab-scroll').forEach((el) => { el.scrollLeft = 0; });
  });
  const scrollTo = async (sel, offset = -8) => {
    await page.locator(sel).first().evaluate((el, o) => {
      el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, o);
    }, offset);
  };
  await scrollTo('section.panel h2');
  await page.screenshot({ path: `/downloads/v2-section-holdings-${vp.label}.png` });
  await scrollTo('h3.ov2-h3');
  await page.screenshot({ path: `/downloads/v2-section-manager-top-${vp.label}.png` });
  await page.getByRole('button', { name: 'Add address' }).evaluate((el) => {
    el.scrollIntoView({ block: 'end' });
    window.scrollBy(0, 8);
  });
  await page.screenshot({ path: `/downloads/v2-section-manager-bottom-${vp.label}.png` });
  await scrollTo('.ab-lookup');
  await page.screenshot({ path: `/downloads/v2-section-lookup-${vp.label}.png` });
  await page.getByText('Recognized priced subtotal:').evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  await page.screenshot({ path: `/downloads/v2-section-lookup-result-${vp.label}.png` });
  await ctx.close();
  console.log(`captured ${vp.label}`);
}
await browser.close();
server.kill();
