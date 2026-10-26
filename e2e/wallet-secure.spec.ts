import { onRequest as evmChallenge } from '../functions/api/v1/auth/wallet/evm/challenge';
import { onRequest as evmVerify } from '../functions/api/v1/auth/wallet/evm/verify';
import { onRequest as evmLinkChallenge } from '../functions/api/v1/auth/wallet/evm/link/challenge';
import { onRequest as evmLinkVerify } from '../functions/api/v1/auth/wallet/evm/link/verify';
import { onRequest as solanaChallenge } from '../functions/api/v1/auth/wallet/solana/challenge';
import { onRequest as solanaVerify } from '../functions/api/v1/auth/wallet/solana/verify';
import { onRequest as solanaLinkChallenge } from '../functions/api/v1/auth/wallet/solana/link/challenge';
import { onRequest as solanaLinkVerify } from '../functions/api/v1/auth/wallet/solana/link/verify';
/** Local actual customer export + actual handlers/SQLite, injected synthetic wallet.
 * No browser extension, production account or provider is exercised. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onRequest as middleware } from '../functions/_middleware';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { createSqliteD1 } from '../tests/helpers/d1-sqlite';
import { handleAddressesList } from '../server/portfolio/addresses';
import { handleNativeLogout, handleNativeSessionInfo } from '../server/auth/session-info';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { requireEntitledSession } from '../server/auth/guards';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { personalSignDigest, toEip55 } from '../server/auth/siwe';
const walletMounts = {
  'evm/challenge': evmChallenge,
  'evm/verify': evmVerify,
  'evm/link/challenge': evmLinkChallenge,
  'evm/link/verify': evmLinkVerify,
  'solana/challenge': solanaChallenge,
  'solana/verify': solanaVerify,
  'solana/link/challenge': solanaLinkChallenge,
  'solana/link/verify': solanaLinkVerify,
};
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
let tlsDir: string;
let browser: Browser;
let server: ChildProcess;
beforeAll(async () => {
  tlsDir = mkdtempSync(join(tmpdir(), 'sola-wallet-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(tlsDir, 'key.pem'),
      '-out',
      join(tlsDir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  server = spawn(process.execPath, ['scripts/serve-static.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, PORT: '3098' },
  });
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3098/sign-in/')).ok) break;
    } catch {
      /* server is not ready yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  rmSync(tlsDir, { recursive: true, force: true });
  if (server && server.exitCode === null)
    await new Promise<void>((r) => {
      server.once('exit', () => r());
      server.kill();
    });
});
for (const mobile of [false, true])
  describe(mobile ? 'phone' : 'desktop', () => {
    for (const network of ['evm', 'solana'] as const)
      for (const mode of ['uninvited', 'invited', 'link'] as const)
        for (const scenario of ['success'] as const)
          it(
            network +
              ' ' +
              scenario +
              ' ' +
              (mode +
                ' ' +
                (mode === 'link'
                  ? 'actual link then full book reconciliation'
                  : 'explicit connect/sign then Continue resumes native destination')),
            async () => {
              const link = mode === 'link';
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
              if (mode !== 'uninvited') {
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
                if (link) cookie = SESSION_COOKIE + '=' + (await createSession(db, 'owner')).id;
                else {
                  const kind = network === 'evm' ? 'wallet_evm' : 'wallet_solana';
                  raw
                    .prepare(
                      'INSERT INTO auth_identities (id,user_id,kind,identifier,verified_at) VALUES (?,?,?,?,?)',
                    )
                    .run(
                      'wallet',
                      'owner',
                      kind,
                      network === 'evm' ? address.toLowerCase() : address,
                      now,
                    );
                }
              }
              const authCalls: string[] = [];
              const emittedCookies: string[] = [];
              let signatures = 0;
              const pageErrors: string[] = [];
              const secure = createServer(
                {
                  key: readFileSync(join(tlsDir, 'key.pem')),
                  cert: readFileSync(join(tlsDir, 'cert.pem')),
                },
                async (incoming, out) => {
                  try {
                    const chunks: Buffer[] = [];
                    for await (const c of incoming) chunks.push(Buffer.from(c));
                    const path = new URL(incoming.url!, 'https://localhost:3447').pathname;
                    const req = new Request('https://localhost:3447' + incoming.url, {
                      method: incoming.method,
                      headers: incoming.headers as Record<string, string>,
                      body: incoming.method === 'POST' ? Buffer.concat(chunks) : undefined,
                    });
                    const response = await middleware({
                      request: req,
                      env,
                      next: async () => {
                        let response: Response;
                        if (path === '/api/v1/auth/email/logout')
                          response = await handleNativeLogout(req, env);
                        else if (path === '/api/v1/auth/email/session')
                          response = await handleNativeSessionInfo(req, env);
                        else if (path.startsWith('/api/v1/auth/wallet/')) {
                          authCalls.push(path);
                          const key = path.slice(
                            '/api/v1/auth/wallet/'.length,
                          ) as keyof typeof walletMounts;
                          const mount = walletMounts[key];
                          response = mount
                            ? await mount({ request: req, env })
                            : new Response(null, { status: 404 });
                        } else if (path === '/api/v1/portfolio/addresses')
                          response = await handleAddressesList(req, env);
                        else if (path.startsWith('/api/'))
                          response = new Response(JSON.stringify({ error: 'auth_required' }), {
                            status: 401,
                          });
                        else
                          response = await fetch('http://127.0.0.1:3098' + incoming.url, {
                            redirect: 'manual',
                          });
                        return response;
                      },
                    });
                    const headers = Object.fromEntries(
                      [...response.headers].filter(
                        ([k]) => !['content-encoding', 'content-length', 'set-cookie'].includes(k),
                      ),
                    );
                    const cookies = response.headers.getSetCookie();
                    emittedCookies.push(...cookies);
                    out.writeHead(response.status, {
                      ...headers,
                      ...(cookies.length ? { 'set-cookie': cookies } : {}),
                    });
                    out.end(Buffer.from(await response.arrayBuffer()));
                  } catch (error) {
                    out.writeHead(500);
                    out.end(String(error));
                  }
                },
              );
              await new Promise<void>((r) => secure.listen(3447, '127.0.0.1', r));
              const ctx = await browser.newContext({
                ignoreHTTPSErrors: true,
                viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
              });
              if (link)
                await ctx.addCookies([
                  {
                    name: SESSION_COOKIE,
                    value: cookie.slice(SESSION_COOKIE.length + 1),
                    url: 'https://localhost:3447',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'Lax',
                  },
                ]);
              const page = await ctx.newPage();
              page.setDefaultTimeout(6000);
              page.on('pageerror', (e) => pageErrors.push(e.message));
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
              try {
                await page.goto(
                  link
                    ? 'https://localhost:3447/account/'
                    : 'https://localhost:3447/sign-in/?next=%2Faccount%2Frisk',
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
                  const documentResponse = page.waitForResponse(
                    (r) =>
                      ![301, 302, 303, 307, 308].includes(r.status()) &&
                      r.request().isNavigationRequest() &&
                      new URL(r.url()).pathname.replace(/\/$/, '') === '/account/risk',
                  );
                  await page.getByRole('link', { name: 'Continue', exact: true }).click();
                  const html = await documentResponse;
                  expect(html.status()).toBe(mode === 'uninvited' ? 403 : 200);
                  expect(html.headers()['cache-control']).toBe('no-store');
                  await page.waitForURL(/\/account\/risk\/?$/);
                  const stored = await ctx.cookies();
                  const session = stored.find((c) => c.name === SESSION_COOKIE);
                  expect(session).toMatchObject({
                    domain: 'localhost',
                    path: '/',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'Lax',
                  });
                  cookie = SESSION_COOKIE + '=' + session!.value;
                  expect(stored.filter((c) => c.name === SESSION_COOKIE)).toHaveLength(1);
                  if (mode === 'uninvited')
                    await page
                      .getByText('This signed-in account is not invited.', { exact: false })
                      .waitFor();
                  else
                    await page
                      .getByRole('heading', { name: 'Risk & Return', exact: false })
                      .waitFor();
                  const native = await handleNativeSessionInfo(
                    new Request('https://localhost:3447/api/v1/auth/email/session', {
                      headers: { cookie },
                    }),
                    env,
                  );
                  expect(native.status).toBe(200);
                  const denial = await requireEntitledSession(
                    new Request('https://localhost:3447/x', { headers: { cookie } }),
                    db,
                  );
                  if (mode === 'uninvited') {
                    expect((denial as Response).status).toBe(403);
                    const protectedApi = await ctx.request.get(
                      'https://localhost:3447/api/v1/portfolio/addresses',
                    );
                    expect(protectedApi.status()).toBe(403);
                    expect((await protectedApi.json()).error).toBe('not_entitled');
                    expect(await page.locator('body').innerText()).not.toContain('Risk & Return');
                    expect(emittedCookies).toHaveLength(1);
                    expect(emittedCookies[0]).not.toMatch(/domain=/i);
                    expect(emittedCookies[0]).toMatch(/Secure/);
                    expect(emittedCookies[0]).toMatch(/HttpOnly/);
                    expect(emittedCookies[0]).toMatch(/SameSite=Lax/);
                    await page.screenshot({
                      path: `/downloads/r3-wallet-denied-${network}-${mobile ? 'phone' : 'desktop'}.png`,
                    });
                    await page
                      .getByRole('link', {
                        name: 'Return to sign-in to switch account or sign out',
                      })
                      .click();
                    await page.getByRole('button', { name: 'Find wallets' }).waitFor();
                    await page.getByRole('button', { name: /^Account:/ }).click();
                    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
                    await page.getByRole('button', { name: 'Find wallets' }).waitFor();
                    expect((await ctx.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(
                      false,
                    );
                    const revoked = await ctx.request.get(
                      'https://localhost:3447/api/v1/auth/email/session',
                    );
                    expect(revoked.status()).toBe(401);
                    await page.waitForURL(/\/sign-in\/?$/);
                    await page.waitForLoadState('load');
                    await page.getByRole('button', { name: 'Find wallets' }).waitFor();
                  } else expect(denial).not.toBeInstanceOf(Response);
                }
                expect(pageErrors).toEqual([]);
                expect(signatures).toBe(1);
                expect(authCalls).toHaveLength(2);
                const cookiesBefore = emittedCookies.length;
                const challengeUrl = `https://localhost:3447/api/v1/auth/wallet/${network}/challenge`;
                const badMethod = await ctx.request.get(challengeUrl);
                expect(badMethod.status()).toBe(405);
                expect(badMethod.headers()['set-cookie']).toBeUndefined();
                const badOrigin = await ctx.request.post(challengeUrl, {
                  headers: { origin: 'https://other.invalid' },
                  data: { address },
                });
                expect(badOrigin.status()).toBe(403);
                expect(badOrigin.headers()['set-cookie']).toBeUndefined();
                expect(emittedCookies).toHaveLength(cookiesBefore);
                if (mode === 'invited') {
                  await page.goto('https://localhost:3447/account/');
                  await page.getByRole('button', { name: 'Find wallets' }).waitFor();
                }
                if (mode !== 'uninvited')
                  await page.screenshot({
                    path: `/downloads/r3-wallet-secure-${network}-${mode}-${mobile ? 'phone' : 'desktop'}.png`,
                  });
              } finally {
                await ctx.close();
                secure.closeAllConnections();
                await new Promise<void>((r) => secure.close(() => r()));
                try {
                  raw.close();
                } catch {
                  /* already closed by an early scenario */
                }
              }
            },
          );
  });
