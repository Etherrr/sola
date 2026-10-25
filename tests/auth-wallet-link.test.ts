import { describe, it, expect, beforeEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleWalletLinkChallenge, handleWalletLinkVerify } from '../server/auth/wallet';
import { toEip55, personalSignDigest } from '../server/auth/siwe';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import { createSession } from '../server/auth/sessions';

const post = (body: unknown, cookie?: string, origin: string | null = 'https://preview.test'): Request =>
  new Request('https://preview.test/api/v1/auth/wallet/link/x', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const evmPriv = secp256k1.utils.randomPrivateKey();
const evmAddress = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(evmPriv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
const evmPriv2 = secp256k1.utils.randomPrivateKey();
const evmAddress2 = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(evmPriv2, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));

const signEvm = (priv: Uint8Array) => (message: string): string => {
  const sig = secp256k1.sign(personalSignDigest(message), priv);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return '0x' + hex(sig.toCompactRawBytes()) + (sig.recovery! + 27).toString(16).padStart(2, '0');
};

let db: ReturnType<typeof createSqliteD1>['db'];
let env: NativeAuthEnv;
beforeEach(() => {
  ({ db } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
});

const makeUser = async (id: string) => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES (?,'active',?,?)").bind(id, now, now).run();
  const s = await createSession(db, id);
  return `${SESSION_COOKIE}=${s.id}`;
};

describe('wallet link (authenticated, fresh challenge, no auto-transfer)', () => {
  it('requires a live session on both endpoints', async () => {
    expect((await handleWalletLinkChallenge(post({ address: evmAddress }), env, 'evm')).status).toBe(401);
    expect((await handleWalletLinkVerify(post({ address: evmAddress, message: 'x', signature: 'y' }), env, 'evm')).status).toBe(401);
  });

  it('genuine round trip links the wallet to the SESSION user', async () => {
    const cookie = await makeUser('u1');
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    expect(ch.status).toBe(200);
    const { message } = (await ch.json()) as { message: string };
    const r = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie), env, 'evm');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { linked: string }).linked).toBe('added');
    const ident = await db
      .prepare("SELECT user_id FROM auth_identities WHERE kind='wallet_evm' AND identifier=?")
      .bind(evmAddress.toLowerCase()).first<{ user_id: string }>();
    expect(ident!.user_id).toBe('u1');
    const link = await db
      .prepare("SELECT user_id, chain, address FROM wallet_links WHERE address=?")
      .bind(evmAddress).first<{ user_id: string; chain: string; address: string }>();
    expect(link!.user_id).toBe('u1');
    // linking again is idempotent for the same user
    const ch2 = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    const { message: m2 } = (await ch2.json()) as { message: string };
    const r2 = await handleWalletLinkVerify(
      post({ address: evmAddress, message: m2, signature: signEvm(evmPriv)(m2) }, cookie), env, 'evm');
    expect(((await r2.json()) as { linked: string }).linked).toBe('already');
  });

  it("a challenge issued in one user's session cannot be claimed in another's", async () => {
    const cookie1 = await makeUser('u1');
    const cookie2 = await makeUser('u2');
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie1), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    const r = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie2), env, 'evm');
    expect(r.status).toBe(401); // challenge subject binds link:u1:... - u2 cannot claim it
    // and the signature did NOT burn u1's challenge
    const r1 = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie1), env, 'evm');
    expect(r1.status).toBe(200);
  });

  it('a wallet verified on another account is refused 409, never transferred', async () => {
    const cookie1 = await makeUser('u1');
    const cookie2 = await makeUser('u2');
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie1), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie1), env, 'evm');
    // u2 now proves the same wallet with a genuine fresh challenge + signature
    const ch2 = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie2), env, 'evm');
    const { message: m2 } = (await ch2.json()) as { message: string };
    const r = await handleWalletLinkVerify(
      post({ address: evmAddress, message: m2, signature: signEvm(evmPriv)(m2) }, cookie2), env, 'evm');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe('wallet_linked_elsewhere');
    const ident = await db
      .prepare("SELECT user_id FROM auth_identities WHERE kind='wallet_evm' AND identifier=?")
      .bind(evmAddress.toLowerCase()).first<{ user_id: string }>();
    expect(ident!.user_id).toBe('u1'); // still u1
  });

  it('a bad signature neither links nor burns the challenge', async () => {
    const cookie = await makeUser('u1');
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    const bad = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv2)(message) }, cookie), env, 'evm');
    expect(bad.status).toBe(401);
    const good = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie), env, 'evm');
    expect(good.status).toBe(200);
  });

  it('a different wallet than the challenged one cannot claim (address binding)', async () => {
    const cookie = await makeUser('u1');
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    // challenge was for evmAddress; attacker replays claiming evmAddress2
    const r = await handleWalletLinkVerify(
      post({ address: evmAddress2, message, signature: signEvm(evmPriv)(message) }, cookie), env, 'evm');
    expect(r.status).toBe(401);
  });
});
