import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { personalSignDigest, toEip55 } from '../server/auth/siwe';
import { onRequest as evmChallenge } from '../functions/api/v1/auth/wallet/evm/challenge';
import { onRequest as evmVerify } from '../functions/api/v1/auth/wallet/evm/verify';
import { onRequest as evmLinkChallenge } from '../functions/api/v1/auth/wallet/evm/link/challenge';
import { onRequest as evmLinkVerify } from '../functions/api/v1/auth/wallet/evm/link/verify';
import { onRequest as solanaChallenge } from '../functions/api/v1/auth/wallet/solana/challenge';
import { onRequest as solanaVerify } from '../functions/api/v1/auth/wallet/solana/verify';
import { onRequest as solanaLinkChallenge } from '../functions/api/v1/auth/wallet/solana/link/challenge';
import { onRequest as solanaLinkVerify } from '../functions/api/v1/auth/wallet/solana/link/verify';
const mounts = {
  'evm/challenge': evmChallenge,
  'evm/verify': evmVerify,
  'evm/link/challenge': evmLinkChallenge,
  'evm/link/verify': evmLinkVerify,
  'solana/challenge': solanaChallenge,
  'solana/verify': solanaVerify,
  'solana/link/challenge': solanaLinkChallenge,
  'solana/link/verify': solanaLinkVerify,
};
const b58 = (bytes: Uint8Array) => {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (n) {
    s = alphabet[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = '1' + s;
    else break;
  }
  return s;
};
for (const chain of ['evm', 'solana'] as const)
  for (const link of [false, true])
    describe(`mounted ${chain} ${link ? 'link' : 'sign-in'}`, () => {
      const path = `${chain}/${link ? 'link/' : ''}`;
      const challenge = mounts[(path + 'challenge') as keyof typeof mounts];
      const verify = mounts[(path + 'verify') as keyof typeof mounts];
      const fixture = async () => {
        const { db, raw } = createSqliteD1();
        const env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
        let cookie = '';
        if (link) {
          const now = new Date().toISOString();
          raw.prepare("INSERT INTO users VALUES ('owner','active',?,?)").run(now, now);
          cookie = SESSION_COOKIE + '=' + (await createSession(db, 'owner')).id;
        }
        const key =
          chain === 'evm' ? secp256k1.utils.randomPrivateKey() : ed25519.utils.randomPrivateKey();
        const address =
          chain === 'evm'
            ? toEip55(
                '0x' +
                  Buffer.from(
                    keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(-20),
                  ).toString('hex'),
              )
            : b58(ed25519.getPublicKey(key));
        const request = (action: string, body: unknown, origin = 'https://preview.test') =>
          new Request('https://preview.test/api/v1/auth/wallet/' + path + action, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json', cookie },
            body: JSON.stringify(body),
          });
        const sign = (message: string) => {
          if (chain === 'solana')
            return Buffer.from(ed25519.sign(new TextEncoder().encode(message), key)).toString(
              'base64',
            );
          const s = secp256k1.sign(personalSignDigest(message), key);
          return (
            '0x' +
            Buffer.from(s.toCompactRawBytes()).toString('hex') +
            (s.recovery! + 27).toString(16).padStart(2, '0')
          );
        };
        return { db, raw, env, address, request, sign, cookie };
      };
      it('exact imported route chain/handler creates bound proof and rejects replay', async () => {
        const f = await fixture();
        try {
          const c = await challenge({
            request: f.request('challenge', { address: f.address }),
            env: f.env,
          });
          expect(c.status).toBe(200);
          const { message } = await c.json();
          expect(message).toContain(chain === 'evm' ? 'Ethereum account:' : 'Solana account:');
          const body = { address: f.address, message, signature: f.sign(message) };
          const good = await verify({ request: f.request('verify', body), env: f.env });
          expect(good.status).toBe(200);
          expect(good.headers.get('cache-control')).toBe('no-store');
          if (link) {
            expect(good.headers.has('set-cookie')).toBe(false);
            expect(f.raw.prepare('SELECT user_id FROM wallet_links').get()).toMatchObject({
              user_id: 'owner',
            });
            expect(
              f.raw.prepare('SELECT verification FROM portfolio_addresses').get(),
            ).toMatchObject({ verification: 'verified' });
          } else expect(good.headers.get('set-cookie')).toContain('Secure');
          const replay = await verify({ request: f.request('verify', body), env: f.env });
          expect(replay.status).toBe(401);
          expect(replay.headers.has('set-cookie')).toBe(false);
        } finally {
          f.raw.close();
        }
      });
      it('all exact mounts retain method/origin/body/flag guards and no cookie', async () => {
        const f = await fixture();
        try {
          for (const [action, mount] of [
            ['challenge', challenge],
            ['verify', verify],
          ] as const) {
            for (const [request, status] of [
              [new Request('https://preview.test/api/v1/auth/wallet/' + path + action), 405],
              [f.request(action, {}, 'https://other.invalid'), 403],
              [
                new Request('https://preview.test/api/v1/auth/wallet/' + path + action, {
                  method: 'POST',
                  headers: {
                    origin: 'https://preview.test',
                    'content-type': 'application/json',
                    cookie: f.cookie,
                  },
                  body: 'x'.repeat(4097),
                }),
                413,
              ],
            ] as const) {
              const r = await mount({ request, env: f.env });
              expect(r.status).toBe(status);
              expect(r.headers.has('set-cookie')).toBe(false);
              expect(r.headers.get('cache-control')).toBe('no-store');
            }
            const off = await mount({
              request: f.request(action, { address: f.address }),
              env: { ...f.env, NATIVE_AUTH_ENABLED: 'false' },
            });
            expect(off.status).toBe(503);
            expect(off.headers.has('set-cookie')).toBe(false);
          }
        } finally {
          f.raw.close();
        }
      });
    });
