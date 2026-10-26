/* Capture /account (native combined), /portfolio (legacy, no demo), /demo on the
   local static build with contract-faithful mocked APIs. Emulated evidence. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const server = spawn('npm', ['run', 'start'], { stdio: 'ignore', cwd: '/tmp/sola-fresh' });
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:3000/portfolio/'); if (r.ok) return; } catch { /* best-effort warmup */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
};
await waitUp();
const browser = await chromium.launch();
const eth = '0x' + 'a'.repeat(40);
const sol = 'So1DemoAddr9' + 'z'.repeat(31);

async function mockNative(page) {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', email: 'jun@example.com', fresh: true } }));
  await page.route('**/api/v1/portfolio/addresses', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', addresses: [
      { network: 'ethereum', address: eth, label: 'Cold wallet', verification: 'watched', createdAt: '2026-10-25T00:00:00Z', lastObservedAt: null },
      { network: 'solana', address: sol, label: 'Solar', verification: 'watched', createdAt: '2026-10-25T00:00:00Z', lastObservedAt: null },
    ] } }));
  await page.route('**/api/v1/portfolio/resolve', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const isEth = body.network === 'ethereum';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 1, requestId: 'r', generatedAt: '2026-10-25T05:58:00Z', observedAt: '2026-10-25T05:58:00Z',
      provider: 'test-live', chainId: isEth ? 1 : null, network: body.network, mode: 'live', simulated: false,
      wallets: [{ address: body.addresses[0], assets: [{
        assetId: isEth ? 'eip155:1/native' : 'solana:mainnet/native', symbol: isEth ? 'ETH' : 'SOL',
        decimals: 18, amount: isEth ? '1.5' : '20', price: '1', value: isEth ? '4500' : '3000',
        priceSource: 'test-feed', priceObservedAt: '2026-10-25T05:55:00Z' }], partial: false, warnings: [] }],
      totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'test' }, partial: false, warnings: [],
    })});
  });
}
async function mockAccess(page) {
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', via: 'cloudflare-access', identity: { email: 'jun@example.com' }, expiresAt: '2099-01-01T00:00:00.000Z' } }));
}

for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockNative(page);
  await mockAccess(page);
  await page.goto('http://127.0.0.1:3000/account/');
  await page.getByRole('heading', { name: 'All saved addresses' }).waitFor();
  await page.screenshot({ path: `/tmp/pixels-9787e3d-${name}-account-idle.png` });
  await page.getByRole('button', { name: 'Load combined balances' }).click();
  await page.getByText('$7,500.00').first().waitFor();
  await page.screenshot({ path: `/tmp/pixels-9787e3d-${name}-account-loaded.png`, fullPage: name === 'desktop' });
  await page.goto('http://127.0.0.1:3000/portfolio/');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await page.screenshot({ path: `/tmp/pixels-9787e3d-${name}-portfolio.png`, fullPage: name === 'desktop' });
  await page.goto('http://127.0.0.1:3000/demo/');
  await page.getByText('$11,000.00').first().waitFor();
  await page.screenshot({ path: `/tmp/pixels-9787e3d-${name}-demo.png`, fullPage: name === 'desktop' });
  await page.close();
}
await browser.close();
server.kill();
console.log('done');
