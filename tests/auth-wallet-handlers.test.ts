import { describe, it, expect, beforeEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleWalletChallenge, handleWalletVerify } from '../server/auth/wallet';
import { toEip55, personalSignDigest } from '../server/auth/siwe';
import { readSessionCookie, type NativeAuthEnv } from '../server/auth/email';
import { readLiveSession } from '../server/auth/sessions';

const post = (body: unknown, origin: string | null = 'https://preview.test', path = '/api/v1/auth/wallet/x'): Request =>
  new Request('https://preview.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

const evmPriv = secp256k1.utils.randomPrivateKey();
const evmAddress = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(evmPriv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
const solPriv = ed25519.utils.randomPrivateKey();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58Encode = (bytes: Uint8Array): string => {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
};
const solAddress = base58Encode(ed25519.getPublicKey(solPriv));

const signEvm = (message: string): string => {
  const sig = secp256k1.sign(personalSignDigest(message), evmPriv);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return '0x' + hex(sig.toCompactRawBytes()) + (sig.recovery! + 27).toString(16).padStart(2, '0');
};
const signSol = (message: string): string => {
  const sig = ed25519.sign(new TextEncoder().encode(message), solPriv);
  let bin = ''; sig.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

let db: ReturnType<typeof createSqliteD1>['db'];
let env: NativeAuthEnv;
beforeEach(() => {
  ({ db } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
});

const challenge = async (chain: 'evm' | 'solana', address: string) => {
  const r = await handleWalletChallenge(post({ address }), env, chain);
  expect(r.status).toBe(200);
  return (await r.json()) as { message: string; expiresAt: string };
};

describe('wallet challenge handler', () => {
  it('issues a bound SIWE message for a valid EIP-55 address', async () => {
    const { message, expiresAt } = await challenge('evm', evmAddress);
    expect(message).toContain('preview.test wants you to sign in with your Ethereum account:');
    expect(message).toContain(evmAddress);
    expect(message).toContain('URI: https://preview.test/signin');
    expect(message).toContain('Chain ID: 1');
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });
  it('issues a bound SIWS message for a valid Solana address', async () => {
    const { message } = await challenge('solana', solAddress);
    expect(message).toContain('preview.test wants you to sign in with your Solana account:');
    expect(message).toContain(solAddress);
  });
  it('rejects bad addresses, foreign origin, and the disabled flag', async () => {
    expect((await handleWalletChallenge(post({ address: '0x123' }), env, 'evm')).status).toBe(400);
    expect((await handleWalletChallenge(post({ address: evmAddress }, null), env, 'evm')).status).toBe(403);
    expect((await handleWalletChallenge(post({ address: evmAddress }, 'https://evil.test'), env, 'evm')).status).toBe(403);
    env.NATIVE_AUTH_ENABLED = 'false';
    expect((await handleWalletChallenge(post({ address: evmAddress }), env, 'evm')).status).toBe(503);
  });
});

describe('wallet verify handler', () => {
  it('EVM: genuine round trip creates user + identity + wallet_link + live session', async () => {
    const { message } = await challenge('evm', evmAddress);
    const r = await handleWalletVerify(post({ address: evmAddress, message, signature: signEvm(message) }), env, 'evm');
    expect(r.status).toBe(200);
    const { user } = (await r.json()) as { user: { id: string } };
    const link = await db.prepare("SELECT * FROM wallet_links WHERE chain='ethereum'").bind().first<Record<string, unknown>>();
    expect(String(link!.address)).toBe(evmAddress);
    expect(String(link!.user_id)).toBe(user.id);
    const ident = await db.prepare("SELECT kind, identifier FROM auth_identities WHERE user_id=?").bind(user.id).first<{ kind: string; identifier: string }>();
    expect(ident!.kind).toBe('wallet_evm');
    expect(ident!.identifier).toBe(evmAddress.toLowerCase());
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain('__Host-sola_session=');
    expect(cookie).toContain('HttpOnly');
    const req = new Request('https://preview.test/x', { headers: { cookie: cookie.split(';')[0] } });
    const sessionId = readSessionCookie(req)!;
    expect(await readLiveSession(db, sessionId)).not.toBeNull();
  });
  it('Solana: genuine round trip, and the same wallet always resolves to the SAME user (non-transfer)', async () => {
    const c1 = await challenge('solana', solAddress);
    const r1 = await handleWalletVerify(post({ address: solAddress, message: c1.message, signature: signSol(c1.message) }), env, 'solana');
    const u1 = ((await r1.json()) as { user: { id: string } }).user.id;
    const c2 = await challenge('solana', solAddress);
    const r2 = await handleWalletVerify(post({ address: solAddress, message: c2.message, signature: signSol(c2.message) }), env, 'solana');
    const u2 = ((await r2.json()) as { user: { id: string } }).user.id;
    expect(u2).toBe(u1);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM users").bind().first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
  it('replay: the same message+signature can never create a second session', async () => {
    const { message } = await challenge('evm', evmAddress);
    const body = { address: evmAddress, message, signature: signEvm(message) };
    expect((await handleWalletVerify(post(body), env, 'evm')).status).toBe(200);
    const replay = await handleWalletVerify(post(body), env, 'evm');
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_or_consumed_challenge');
    const n = await db.prepare("SELECT COUNT(*) AS n FROM sessions").bind().first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
  it('wrong signature and wrong-chain message are rejected without consuming', async () => {
    const { message } = await challenge('evm', evmAddress);
    const bad = await handleWalletVerify(post({ address: evmAddress, message, signature: signEvm('different message') }), env, 'evm');
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { reason?: string }).reason).toBeDefined();
    const c = await db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE consumed_at IS NULL").bind().first<{ n: number }>();
    expect(c!.n).toBe(1); // bad signature does not burn the challenge
  });
  it('challenge for one address cannot be claimed for another (address binding)', async () => {
    const other = secp256k1.utils.randomPrivateKey();
    const otherAddr = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(other, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
    const { message } = await challenge('evm', evmAddress);
    const r = await handleWalletVerify(post({ address: otherAddr, message, signature: signEvm(message) }), env, 'evm');
    expect(r.status).toBe(401);
  });
});
