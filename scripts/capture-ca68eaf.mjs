import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const server = spawn('npm', ['run', 'start'], { stdio: 'ignore', cwd: '/tmp/sola-fresh' });
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:3000/portfolio/'); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
};
await waitUp();
const browser = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', via: 'cloudflare-access', identity: { email: 'jun@example.com' }, expiresAt: '2099-01-01T00:00:00.000Z' } }));
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', email: 'jun@example.com', fresh: true } }));
  await page.goto('http://127.0.0.1:3000/portfolio/');
  await page.getByText(/your address book and its combined view live on/).waitFor();
  await page.screenshot({ path: `/tmp/pixels-ca68eaf-${name}-portfolio-pointer.png` });
  await page.close();
}
await browser.close();
server.kill();
console.log('done');
