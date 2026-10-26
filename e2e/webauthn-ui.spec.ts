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
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
};

beforeAll(async () => {
  harness = await startUiHarness(8787);
  dev = spawn(process.execPath, ['scripts/serve-static.mjs'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, PORT: '3099' },
  });
  await waitFor('http://127.0.0.1:3099/sign-in/', 30000);
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  if (dev && dev.exitCode === null) {
    await new Promise<void>((resolve) => {
      dev.once('exit', () => resolve());
      dev.kill();
    });
  }
  if (harness) await new Promise<void>((resolve) => harness.close(() => resolve()));
});

describe('passkey through the real UI (virtual authenticator)', () => {
  for (const mobile of [false, true])
    it(`${mobile ? 'phone' : 'desktop'} register via account menu, login via sign-in form, reauth gate, honest negatives`, async () => {
      const ctx = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      });
      try {
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
          options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        });

        // 1. No credential: honest error, no fake state.
        await page.goto(base + '/sign-in/', { waitUntil: 'load', timeout: 30000 });
        await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
        const alert = page.locator('form.accounts [role=alert]');
        await alert.waitFor({ timeout: 30000 });
        expect(await alert.innerText()).toMatch(/no passkey|cancelled/i);

        // 2. Session + register through the real account menu.
        await page.evaluate(async () => {
          await fetch('/__test/session', { method: 'POST' });
        });
        await page.goto(base + '/sign-in/', { waitUntil: 'load', timeout: 30000 });
        await page.getByRole('button', { name: /Account:/ }).click();
        await page.getByRole('button', { name: 'Set up a passkey' }).click();
        await page.getByText('Passkey saved.').waitFor({ timeout: 30000 });

        // 3. Stale session: refused with the sign-in-again prompt.
        await page.evaluate(async () => {
          await fetch('/__test/backdate', { method: 'POST' });
        });
        await page.goto(base + '/sign-in/', { waitUntil: 'load', timeout: 30000 });
        await page.getByRole('button', { name: /Account:/ }).click();
        await page.getByRole('button', { name: 'Set up a passkey' }).click();
        await page.getByText(/sign in again to add a passkey/i).waitFor({ timeout: 30000 });

        // 4. Discoverable-credential login through the real sign-in form.
        await ctx.clearCookies();
        await page.goto(base + '/sign-in/', { waitUntil: 'load', timeout: 30000 });
        await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
        await page.getByText('Signed in.', { exact: true }).waitFor({ timeout: 30000 });
        const navigation = page.waitForResponse(
          (r) =>
            r.request().isNavigationRequest() &&
            r.status() === 200 &&
            new URL(r.url()).pathname === '/account/overview/',
        );
        await page.getByRole('link', { name: 'Continue', exact: true }).click();
        await navigation;
        await expect.poll(() => page.url(), { timeout: 15000 }).toContain('/account/overview');
        await page
          .getByRole('button', { name: 'Account: e2e@preview.test', exact: true })
          .waitFor({ timeout: 30000 });

        expect(errors).toEqual([]);
        const session = (await ctx.cookies()).find((c) => c.name.startsWith('__Host-'));
        expect(session).toMatchObject({
          domain: 'localhost',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        });
        await page.screenshot({
          path: `/downloads/r3-passkey-combined-${mobile ? 'phone' : 'desktop'}.png`,
        });
      } finally {
        await ctx.close();
      }
    });
});
