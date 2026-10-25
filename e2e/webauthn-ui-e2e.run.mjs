// Drives the REAL UI (sign-in form + account menu) against the UI harness.
// Proves the browser client conversion (passkey-client.ts) end to end:
// register through "Set up a passkey", login through "Sign in with a
// passkey", the fresh-session reauth gate, and the no-credential negative.
import { chromium } from 'playwright';

const base = 'https://localhost:8787';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
             hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

const results = [];
const check = (name, cond) => { results.push([name, cond]); console.log(name, cond ? 'PASS' : 'FAIL'); };

// 1. No session, no credential: login through the real sign-in form fails honestly.
await page.goto(base + '/dev/sign-in', { waitUntil: 'load', timeout: 90000 });
await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor({ timeout: 90000 });
await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
await page.getByRole('alert').waitFor({ timeout: 30000 });
const negText = await page.getByRole('alert').innerText();
check('login without credential shows honest error', /no passkey|cancelled/i.test(negText));

// 2. Establish a session, register through the real account menu.
await page.evaluate(async () => { await fetch('/__test/session', { method: 'POST' }); });
await page.goto(base + '/dev/sign-in', { waitUntil: 'load', timeout: 90000 });
await page.getByRole('button', { name: /Account:/ }).waitFor({ timeout: 90000 });
await page.getByRole('button', { name: /Account:/ }).click();
await page.getByRole('button', { name: 'Set up a passkey' }).click();
await page.getByText('Passkey saved.').waitFor({ timeout: 30000 });
check('register through account menu succeeds', true);

// 3. Stale session: registration is refused with the sign-in-again prompt.
await page.evaluate(async () => { await fetch('/__test/backdate', { method: 'POST' }); });
await page.goto(base + '/dev/sign-in', { waitUntil: 'load', timeout: 90000 });
await page.getByRole('button', { name: /Account:/ }).click();
await page.getByRole('button', { name: 'Set up a passkey' }).click();
await page.getByText(/sign in again to add a passkey/i).waitFor({ timeout: 30000 });
check('stale session refused with reauth prompt', true);

// 4. Fresh session again, then LOGIN through the real sign-in form.
await page.evaluate(async () => { await fetch('/__test/session', { method: 'POST' }); });
await ctx.clearCookies(); // signed out; the passkey is a discoverable credential
await page.goto(base + '/dev/sign-in', { waitUntil: 'load', timeout: 90000 });
await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
await page.getByText('Signed in.').waitFor({ timeout: 30000 });
check('login through sign-in form succeeds', true);

const pass = results.every(([, c]) => c);
console.log('UI_E2E_RESULT:', pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
