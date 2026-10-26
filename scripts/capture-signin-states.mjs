/* global fetch, setTimeout, console */
/* Capture new sign-in code states on the local static build, mocked APIs.
   Emulated-viewport evidence, not a live session. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const server = spawn('npm', ['run', 'start'], { stdio: 'ignore', cwd: '/tmp/sola-fresh' });
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:3000/dev/sign-in/'); if (r.ok) return; } catch { /* not up yet - retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
};
await waitUp();
const browser = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  await page.route('**/api/v1/auth/email/challenge', (r) =>
    r.fulfill({ status: 200, json: { status: 'ok', expiresAt: new Date(Date.now() + 600_000).toISOString() } }));
  await page.route('**/api/v1/auth/email/verify', (r) =>
    r.fulfill({ status: 401, json: { error: 'invalid_code' } }));
  await page.goto('http://127.0.0.1:3000/dev/sign-in/');
  await page.getByLabel(/email you were invited with/i).fill('member@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await page.getByLabel(/email code/i).waitFor();
  await page.screenshot({ path: `/tmp/pixels-484e304-${name}-code-entry.png` });
  await page.getByLabel(/email code/i).fill('00000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('p[role=alert]').waitFor();
  await page.screenshot({ path: `/tmp/pixels-484e304-${name}-wrong-code.png` });
  await page.close();
}
await browser.close();
server.kill();
console.log('done');
