/** Local actual customer export + actual handlers/SQLite, injected synthetic wallet.
 * No browser extension, production account or provider is exercised. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { createSqliteD1 } from '../tests/helpers/d1-sqlite';
import {
  handleWalletChallenge,
  handleWalletVerify,
  handleWalletLinkChallenge,
  handleWalletLinkVerify,
} from '../server/auth/wallet';
import { handleAddressesList } from '../server/portfolio/addresses';
import { handleNativeSessionInfo } from '../server/auth/session-info';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { requireEntitledSession } from '../server/auth/guards';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { personalSignDigest, toEip55 } from '../server/auth/siwe';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58Encode = (bytes: Uint8Array): string => {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = '1' + s;
    else break;
  }
  return s;
};
let browser: Browser;
let server: ChildProcess;
beforeAll(async () => {
  server = spawn(process.execPath, ['scripts/serve-static.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, PORT: '3097' },
  });
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3097/sign-in/')).ok) break;
    } catch {
      /* server is not ready yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  if (server && server.exitCode === null)
    await new Promise<void>((r) => {
      server.once('exit', () => r());
      server.kill();
    });
});
for (const mobile of [false, true])
  describe(mobile ? 'phone' : 'desktop', () => {
    for (const network of ['evm', 'solana'] as const)
      for (const link of [false, true])
        for (const scenario of ['success', 'unmount-challenge', 'uncertain'] as const)
          it(
            network +
              ' ' +
              scenario +
              ' ' +
              (link
                ? 'actual link then full book reconciliation'
                : 'explicit connect/sign then Continue resumes native destination'),
            async () => {
              const { db, raw } = createSqliteD1();
              const env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
              const solKey = ed25519.utils.randomPrivateKey();
              const solPublic = ed25519.getPublicKey(solKey);
              const privateKey = secp256k1.utils.randomPrivateKey();
              const address =
                network === 'solana'
                  ? base58Encode(solPublic)
                  : toEip55(
                      '0x' +
                        Buffer.from(
                          keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(-20),
                        ).toString('hex'),
                    );
              let cookie = '';
              if (link) {
                const now = new Date().toISOString();
                raw.prepare("INSERT INTO users VALUES ('owner','active',?,?)").run(now, now);
                raw
                  .prepare(
                    "INSERT INTO auth_identities (id,user_id,kind,identifier,verified_at) VALUES ('email','owner','email','fixture@example.test',?)",
                  )
                  .run(now);
                raw
                  .prepare(
                    "INSERT INTO entitlements (id,email,granted_by,created_at) VALUES ('invite','fixture@example.test','local-fixture',?)",
                  )
                  .run(now);
                cookie = SESSION_COOKIE + '=' + (await createSession(db, 'owner')).id;
              }
              const ctx = await browser.newContext({
                viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
              });
              const page = await ctx.newPage();
              page.setDefaultTimeout(6000);
              const pageErrors: string[] = [];
              page.on('pageerror', (e) => pageErrors.push(e.message));
              let signatures = 0;
              const authCalls: string[] = [];
              let finishChallenge = () => {};
              const challengeFinished = new Promise<void>((r) => {
                finishChallenge = r;
              });
              let releaseChallenge = () => {};
              const challengeGate = new Promise<void>((r) => {
                releaseChallenge = r;
              });
              await page.exposeFunction('__syntheticSign', async (messageHex: string) => {
                signatures++;
                const message = Buffer.from(messageHex.slice(2), 'hex').toString('utf8');
                const s = secp256k1.sign(personalSignDigest(message), privateKey);
                return (
                  '0x' +
                  Buffer.from(s.toCompactRawBytes()).toString('hex') +
                  (s.recovery! + 27).toString(16).padStart(2, '0')
                );
              });
              await page.exposeFunction('__syntheticSolSign', async (bytes: number[]) => {
                signatures++;
                return Array.from(ed25519.sign(new Uint8Array(bytes), solKey));
              });
              await page.addInitScript(
                ({ address, network, solPublic }) => {
                  if (network === 'solana') {
                    const account = {
                      address,
                      publicKey: new Uint8Array(solPublic),
                      chains: ['solana:mainnet'],
                      features: ['solana:signMessage'],
                    };
                    const wallet = {
                      version: '1.0.0',
                      name: 'Synthetic Solana wallet',
                      icon: 'data:image/svg+xml;base64,',
                      chains: ['solana:mainnet'],
                      accounts: [account],
                      features: {
                        'standard:connect': {
                          version: '1.0.0',
                          connect: async () => ({ accounts: [account] }),
                        },
                        'standard:events': { version: '1.0.0', on: () => () => {} },
                        'solana:signMessage': {
                          version: '1.0.0',
                          signMessage: async ({ message }: { message: Uint8Array }) => [
                            {
                              signedMessage: message,
                              signature: new Uint8Array(
                                await (
                                  window as unknown as {
                                    __syntheticSolSign: (b: number[]) => Promise<number[]>;
                                  }
                                ).__syntheticSolSign(Array.from(message)),
                              ),
                              signatureType: 'ed25519',
                            },
                          ],
                        },
                      },
                    };
                    window.addEventListener('wallet-standard:app-ready', ((e: CustomEvent) =>
                      e.detail.register(wallet)) as EventListener);
                    return;
                  }
                  const callbacks = new Map<string, Set<() => void>>();
                  const provider = {
                    request: async ({ method, params }: { method: string; params?: string[] }) => {
                      if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                        return [address];
                      if (method === 'eth_chainId') return '0x1';
                      if (method === 'personal_sign')
                        return (
                          window as unknown as { __syntheticSign: (s: string) => Promise<string> }
                        ).__syntheticSign(params![0]);
                      throw Error('Forbidden method ' + method);
                    },
                    on: (e: string, f: () => void) => {
                      if (!callbacks.has(e)) callbacks.set(e, new Set());
                      callbacks.get(e)!.add(f);
                    },
                    removeListener: (e: string, f: () => void) => callbacks.get(e)?.delete(f),
                  };
                  const announce = () =>
                    window.dispatchEvent(
                      new CustomEvent('eip6963:announceProvider', {
                        detail: {
                          info: { uuid: 'synthetic-one', name: 'Synthetic EVM wallet' },
                          provider,
                        },
                      }),
                    );
                  window.addEventListener('eip6963:requestProvider', announce);
                },
                { address, network, solPublic: Array.from(solPublic) },
              );
              await page.route('https://preview.test/**', async (route) => {
                const u = new URL(route.request().url());
                const r = await fetch('http://127.0.0.1:3097' + u.pathname + u.search, {
                  redirect: 'follow',
                });
                await route.fulfill({
                  status: r.status,
                  headers: Object.fromEntries(
                    [...r.headers].filter(
                      ([k]) => !['content-encoding', 'content-length'].includes(k),
                    ),
                  ),
                  body: Buffer.from(await r.arrayBuffer()),
                });
              });
              await page.route('**/api/v1/**', async (route) => {
                const path = new URL(route.request().url()).pathname;
                const req = new Request('https://preview.test' + path, {
                  method: route.request().method(),
                  headers: {
                    origin: 'https://preview.test',
                    'content-type': 'application/json',
                    cookie,
                  },
                  body:
                    route.request().method() === 'POST' ? route.request().postData() : undefined,
                });
                let response: Response;
                if (path === '/api/v1/auth/email/session')
                  response = await handleNativeSessionInfo(req, env);
                else if (path.startsWith('/api/v1/auth/wallet/')) {
                  authCalls.push(path);
                  if (scenario === 'unmount-challenge' && path.endsWith('/challenge'))
                    await challengeGate;
                  const linking = path.includes('/link/');
                  const challenge = path.endsWith('/challenge');
                  response = await (
                    linking
                      ? challenge
                        ? handleWalletLinkChallenge
                        : handleWalletLinkVerify
                      : challenge
                        ? handleWalletChallenge
                        : handleWalletVerify
                  )(req, env, network);
                  if (response.headers.get('set-cookie'))
                    cookie = response.headers.get('set-cookie')!.split(';')[0];
                } else if (path === '/api/v1/portfolio/addresses')
                  response = await handleAddressesList(req, env);
                else
                  response = new Response(JSON.stringify({ error: 'auth_required' }), {
                    status: 401,
                  });
                if (scenario === 'uncertain' && path.endsWith('/verify')) {
                  await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'unavailable' }),
                  });
                  return;
                }
                await route
                  .fulfill({
                    status: response.status,
                    contentType: 'application/json',
                    body: await response.text(),
                  })
                  .catch(() => {
                    /* navigation can abort a pending test-only request */
                  });
                if (path.endsWith('/challenge')) finishChallenge();
              });
              try {
                await page.goto(
                  link
                    ? 'https://preview.test/account/'
                    : 'https://preview.test/sign-in/?next=%2Faccount%2Frisk',
                );
                await page.getByRole('button', { name: 'Find wallets' }).click();
                await page
                  .getByRole('button', {
                    name:
                      network === 'evm'
                        ? 'Synthetic EVM wallet (Ethereum)'
                        : 'Synthetic Solana wallet (Solana)',
                  })
                  .click();
                await page
                  .getByRole('button', {
                    name: link ? 'Sign message to verify and link' : 'Sign message to sign in',
                  })
                  .waitFor();
                expect(authCalls).toEqual([]);
                expect(signatures).toBe(0);
                // Clearing/reconnecting must not sign or create a server challenge.
                await page.getByRole('button', { name: 'Clear wallet selection' }).click();
                await page
                  .getByRole('button', {
                    name:
                      network === 'evm'
                        ? 'Synthetic EVM wallet (Ethereum)'
                        : 'Synthetic Solana wallet (Solana)',
                  })
                  .click();
                const sign = page.getByRole('button', {
                  name: link ? 'Sign message to verify and link' : 'Sign message to sign in',
                });
                await sign.waitFor();
                expect(authCalls).toEqual([]);
                expect(signatures).toBe(0);
                // Two synchronous customer clicks still produce only one proof flow.
                await sign.evaluate((button) => {
                  (button as HTMLButtonElement).click();
                  (button as HTMLButtonElement).click();
                });
                if (scenario === 'unmount-challenge') {
                  await page
                    .getByText('Waiting for the message step...', { exact: true })
                    .waitFor();
                  await page.goto('https://preview.test/connect/');
                  releaseChallenge();
                  await challengeFinished;
                  await page.getByRole('heading', { level: 1 }).waitFor();
                  expect(signatures).toBe(0);
                  expect(authCalls).toHaveLength(1);
                  expect(authCalls[0]).toMatch(/challenge$/);
                  expect(pageErrors).toEqual([]);
                  return;
                }
                if (scenario === 'uncertain') {
                  const alert = page.getByRole('alert');
                  await alert
                    .getByText('The server result could not be confirmed.', { exact: false })
                    .waitFor();
                  expect(
                    await page.getByRole('button', { name: 'Clear wallet selection' }).isDisabled(),
                  ).toBe(true);
                  expect(
                    await page
                      .getByRole('button', {
                        name:
                          network === 'evm'
                            ? 'Synthetic EVM wallet (Ethereum)'
                            : 'Synthetic Solana wallet (Solana)',
                      })
                      .isDisabled(),
                  ).toBe(true);
                  expect(authCalls).toHaveLength(2);
                  expect(signatures).toBe(1);
                  expect(pageErrors).toEqual([]);
                  await page.screenshot({
                    path: `/downloads/r3-wallet-customer-${network}-uncertain-${link ? 'link' : 'signin'}-${mobile ? 'phone' : 'desktop'}.png`,
                  });
                  // The actual server accepted the proof but its response was replaced.
                  // Only full account navigation reconciles the saved session/link.
                  await alert.getByRole('link').click();
                  if (link) {
                    await page.getByText('Verified', { exact: true }).first().waitFor();
                    await page
                      .locator(
                        `code[title="${network === 'evm' ? address.toLowerCase() : address}"]`,
                      )
                      .waitFor();
                  } else {
                    await page.waitForURL(/\/account\/overview\/?$/);
                    const native = await handleNativeSessionInfo(
                      new Request('https://preview.test/api/v1/auth/email/session', {
                        headers: { cookie },
                      }),
                      env,
                    );
                    expect(native.status).toBe(200);
                  }
                  expect(signatures).toBe(1);
                  expect(authCalls).toHaveLength(2);
                  expect(pageErrors).toEqual([]);
                  return;
                }

                await page
                  .getByRole('link', {
                    name: link ? 'Reload address book' : 'Continue',
                    exact: true,
                  })
                  .waitFor();
                expect(authCalls).toHaveLength(2);
                expect(signatures).toBe(1);
                if (link) {
                  expect(raw.prepare('SELECT user_id FROM wallet_links').get()).toMatchObject({
                    user_id: 'owner',
                  });
                  await page
                    .getByRole('link', { name: 'Reload address book', exact: true })
                    .click();
                  await page.getByText('Verified', { exact: true }).first().waitFor();
                  await page
                    .locator(`code[title="${network === 'evm' ? address.toLowerCase() : address}"]`)
                    .waitFor();
                } else {
                  await page.getByRole('link', { name: 'Continue', exact: true }).click();
                  await page.waitForURL(/\/account\/risk\/?$/);
                  const native = await handleNativeSessionInfo(
                    new Request('https://preview.test/api/v1/auth/email/session', {
                      headers: { cookie },
                    }),
                    env,
                  );
                  expect(native.status).toBe(200);
                  const denial = await requireEntitledSession(
                    new Request('https://preview.test/x', { headers: { cookie } }),
                    db,
                  );
                  expect((denial as Response).status).toBe(403);
                }
                expect(pageErrors).toEqual([]);
                expect(signatures).toBe(1);
                expect(authCalls).toHaveLength(2);
                await page.screenshot({
                  path: `/downloads/r3-wallet-customer-${network}-${link ? 'link' : 'signin'}-${mobile ? 'phone' : 'desktop'}.png`,
                });
              } finally {
                releaseChallenge();
                await ctx.close();
                try {
                  raw.close();
                } catch {
                  /* already closed by an early scenario */
                }
              }
            },
          );
  });

for (const mobile of [false, true])
  for (const path of ['sign-in', 'create-account'])
    it(`actual ${path} idle entry ${mobile ? 'phone' : 'desktop'}`, async () => {
      const ctx = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      });
      const page = await ctx.newPage();
      const errors: string[] = [];
      const api: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://preview.test/**', async (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/api/')) {
          api.push(u.pathname);
          await route.fulfill({ status: 401, body: JSON.stringify({ error: 'auth_required' }) });
          return;
        }
        const r = await fetch('http://127.0.0.1:3097' + u.pathname + u.search);
        await route.fulfill({
          status: r.status,
          headers: Object.fromEntries(
            [...r.headers].filter(([k]) => !['content-encoding', 'content-length'].includes(k)),
          ),
          body: Buffer.from(await r.arrayBuffer()),
        });
      });
      try {
        await page.goto(`https://preview.test/${path}/`);
        await page.getByRole('button', { name: 'Find wallets' }).waitFor();
        await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
        expect(errors).toEqual([]);
        expect(api.filter((p) => p.includes('/wallet/'))).toEqual([]);
        await page.screenshot({
          path: `/downloads/r3-wallet-customer-entry-${path}-${mobile ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        });
      } finally {
        await ctx.close();
      }
    });
