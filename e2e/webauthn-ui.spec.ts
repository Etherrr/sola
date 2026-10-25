/**
 * REAL-UI virtual-authenticator ceremony (reviewer readiness item): the actual
 * sign-in form + account menu (STATIC BUILD, served exactly like Pages) drive
 * genuine WebAuthn ceremonies through features/auth-v2/passkey-client.ts
 * against the real reviewed handlers. Requires `npm run build` first.
 * Run: npx vitest run --config e2e/vitest.ui.config.mjs
 * NOT part of the default suite (playwright chromium + static server).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { startUiHarness } from './webauthn-ui-harness';
import type { Server } from 'node:https';

const base = 'https://localhost:8787';
let harness: Server;
let dev: ChildProcess;
let browser: Browser;

const waitFor = async (url: string, ms: number) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
};

beforeAll(async () => {
  harness = await startUiHarness(8787);
  dev = spawn('npm', ['start'], { cwd: process.cwd(), stdio: 'ignore' });
  await waitFor('http://127.0.0.1:3000/dev/sign-in/', 30000);
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  dev?.kill();
  harness?.close();
});

describe('passkey through the real UI (virtual authenticator)', () => {
  it('register via account menu, login via sign-in form, reauth gate, honest negatives', async () => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
                 hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    // 1. No credential: honest error, no fake state.
    await page.goto(base + '/dev/sign-in/', { waitUntil: 'load', timeout: 30000 });
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    const alert = page.locator('form.accounts [role=alert]');
    await alert.waitFor({ timeout: 30000 });
    expect(await alert.innerText()).toMatch(/no passkey|cancelled/i);

    // 2. Session + register through the real account menu.
    await page.evaluate(async () => { await fetch('/__test/session', { method: 'POST' }); });
    await page.goto(base + '/dev/sign-in/', { waitUntil: 'load', timeout: 30000 });
    await page.getByRole('button', { name: /Account:/ }).click();
    await page.getByRole('button', { name: 'Set up a passkey' }).click();
    await page.getByText('Passkey saved.').waitFor({ timeout: 30000 });

    // 3. Stale session: refused with the sign-in-again prompt.
    await page.evaluate(async () => { await fetch('/__test/backdate', { method: 'POST' }); });
    await page.goto(base + '/dev/sign-in/', { waitUntil: 'load', timeout: 30000 });
    await page.getByRole('button', { name: /Account:/ }).click();
    await page.getByRole('button', { name: 'Set up a passkey' }).click();
    await page.getByText(/sign in again to add a passkey/i).waitFor({ timeout: 30000 });

    // 4. Discoverable-credential login through the real sign-in form.
    await ctx.clearCookies();
    await page.goto(base + '/dev/sign-in/', { waitUntil: 'load', timeout: 30000 });
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await page.getByText('Signed in.').waitFor({ timeout: 30000 });

    await ctx.close();
  });
});
