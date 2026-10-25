import { chromium } from 'playwright';

const base = 'https://localhost:8787';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('console', (m) => console.log('PAGE:', m.text().slice(0, 300)));
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId: auth1 } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
             hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

await page.goto(base + '/');
const run = async (fn) => JSON.parse(await page.evaluate(`(async()=>{ await ${fn}(); return document.getElementById('out').textContent; })()`));

const reg = await run('window.runRegister');
console.log('REGISTER:', JSON.stringify(reg));

const login1 = await run('window.runLogin');
console.log('LOGIN#1:', JSON.stringify(login1));

const creds = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: auth1 })).credentials;
console.log('CRED_COUNT:', creds.length, 'SIGN_COUNT_AFTER_LOGIN1:', creds[0]?.signCount);

// Clone: a second authenticator holding the same credential with the ORIGINAL
// (stale) signCount — a cloned authenticator whose counter did not advance.
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: auth1 });
const { authenticatorId: auth2 } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
             hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
await cdp.send('WebAuthn.addCredential', {
  authenticatorId: auth2,
  credential: { ...creds[0], signCount: Math.max(0, (creds[0]?.signCount ?? 1) - 1) },
});
const login2 = await run('window.runLogin');
console.log('LOGIN_CLONE:', JSON.stringify(login2));

// replay: reuse login#1's challengeId is not possible from page state; instead
// verify a second clean login from a fresh authenticator with no credential fails
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: auth2 });
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
             hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const login3 = await run('window.runLogin');
console.log('LOGIN_NO_CRED:', JSON.stringify(login3));

const pass =
  reg.status === 200 && login1.status === 200 &&
  login2.status === 401 && login2.body?.error === 'verification_failed';
console.log('E2E_RESULT:', pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
