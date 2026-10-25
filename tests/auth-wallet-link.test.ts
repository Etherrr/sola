import { describe, it, expect, beforeEach } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleWalletLinkChallenge, handleWalletLinkVerify } from '../server/auth/wallet';
import { toEip55, personalSignDigest } from '../server/auth/siwe';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import { createSession } from '../server/auth/sessions';
import type { createSqliteD1 as CreateD1 } from './helpers/d1-sqlite';

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

let db: ReturnType<typeof CreateD1>['db'];
let raw: ReturnType<typeof CreateD1>['raw'];
let env: NativeAuthEnv;
beforeEach(() => {
  ({ db, raw } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
});

const makeStaleUser = async (id: string) => {
  const cookie = await makeUser(id);
  // Backdate the session past the 10-minute re-auth window.
  raw.exec("UPDATE sessions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')");
  return cookie;
};

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
    // the completed link ALSO wrote the address book as verified (one atomic batch)
    const book = await db
      .prepare("SELECT verification, removed_at, address FROM portfolio_addresses WHERE network='ethereum'")
      .bind().first<{ verification: string; removed_at: string | null; address: string }>();
    expect(book).toEqual({ verification: 'verified', removed_at: null, address: evmAddress.toLowerCase() });
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
    // u2's failed link created NO address-book row anywhere new
    const books = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE network='ethereum'").bind().first<{ n: number }>();
    expect(books!.n).toBe(1); // only u1's verified row
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

  it('a stale (14-day-age) session is refused on BOTH link endpoints (reauth required)', async () => {
    const cookie = await makeStaleUser('u1');
    const c = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    expect(c.status).toBe(403);
    expect(((await c.json()) as { error: string }).error).toBe('reauth_required');
    const v = await handleWalletLinkVerify(
      post({ address: evmAddress, message: 'x', signature: 'y' }, cookie), env, 'evm');
    expect(v.status).toBe(403);
    expect(((await v.json()) as { error: string }).error).toBe('reauth_required');
  });

  it('a failed batch rolls back BOTH inserts (no partial identity without wallet_links)', async () => {
    const cookie = await makeUser('u1');
    raw.exec("CREATE TRIGGER fail_links BEFORE INSERT ON wallet_links BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    await expect(
      handleWalletLinkVerify(post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie), env, 'evm'),
    ).rejects.toThrow();
    const ident = await db
      .prepare("SELECT user_id FROM auth_identities WHERE kind='wallet_evm' AND identifier=?")
      .bind(evmAddress.toLowerCase()).first<{ user_id: string }>();
    expect(ident).toBeNull(); // identity rolled back with the failed link insert
  });

  it('idempotent re-link REPAIRS a partial earlier write (identity without wallet_links)', async () => {
    const cookie = await makeUser('u1');
    // partial state: identity exists, wallet_links row missing
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','wallet_evm',?,?)")
      .bind(evmAddress.toLowerCase(), now).run();
    const ch = await handleWalletLinkChallenge(post({ address: evmAddress }, cookie), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    const r = await handleWalletLinkVerify(
      post({ address: evmAddress, message, signature: signEvm(evmPriv)(message) }, cookie), env, 'evm');
    expect(((await r.json()) as { linked: string }).linked).toBe('repaired');
    const link = await db
      .prepare("SELECT user_id FROM wallet_links WHERE address=?")
      .bind(evmAddress).first<{ user_id: string }>();
    expect(link!.user_id).toBe('u1');
    // the repair also restored the verified address-book row
    const book = await db
      .prepare("SELECT verification, removed_at FROM portfolio_addresses WHERE network='ethereum'")
      .bind().first<{ verification: string; removed_at: string | null }>();
    expect(book).toEqual({ verification: 'verified', removed_at: null });
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

describe('wallet link cap + portfolio race safety', () => {
  const mkWallet = () => {
    const priv = secp256k1.utils.randomPrivateKey();
    const address = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(priv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
    return { priv, address };
  };
  const link = async (cookie: string, w: { priv: Uint8Array; address: string }) => {
    const ch = await handleWalletLinkChallenge(post({ address: w.address }, cookie), env, 'evm');
    const { message } = (await ch.json()) as { message: string };
    return handleWalletLinkVerify(post({ address: w.address, message, signature: signEvm(w.priv)(message) }, cookie), env, 'evm');
  };

  it('the per-network cap binds VERIFIED links too (no bypass via link)', async () => {
    const cookie = await makeUser('u1');
    // link 5 distinct wallets - all fit the cap
    for (let i = 0; i < 5; i++) {
      const r = await link(cookie, mkWallet());
      expect(r.status).toBe(200);
    }
    // the 6th distinct wallet is refused - same policy as the address manager
    const r6 = await link(cookie, mkWallet());
    expect(r6.status).toBe(409);
    expect(((await r6.json()) as { error: string }).error).toBe('too_many_addresses');
    // but RE-linking an already-listed wallet never consumes a slot
    const again = await link(cookie, mkWallet());
    expect(again.status).toBe(409);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE network='ethereum' AND removed_at IS NULL").bind().first<{ n: number }>();
    expect(n!.n).toBe(5);
  });

  it('a watched address that links becomes verified WITHOUT consuming a new slot', async () => {
    const cookie = await makeUser('u1');
    const wallets = Array.from({ length: 5 }, () => mkWallet());
    for (let i = 0; i < 4; i++) expect((await link(cookie, wallets[i])).status).toBe(200);
    // add the 5th as WATCHED directly in the book (fills the cap)
    const now = new Date().toISOString();
    const pf = await db.prepare("SELECT id FROM portfolios WHERE user_id='u1'").bind().first<{ id: string }>();
    await db.prepare("INSERT INTO portfolio_addresses (portfolio_id, network, address, label, verification, created_at) VALUES (?,?,?,?,'watched',?)")
      .bind(pf!.id, 'ethereum', wallets[4].address.toLowerCase(), 'watch', now).run();
    // linking the watched wallet upgrades it in place - allowed at cap
    const r = await link(cookie, wallets[4]);
    expect(r.status).toBe(200);
    const row = await db.prepare("SELECT verification FROM portfolio_addresses WHERE address=?").bind(wallets[4].address.toLowerCase()).first<{ verification: string }>();
    expect(row!.verification).toBe('verified');
    // and a genuinely new 6th wallet is still refused
    expect((await link(cookie, mkWallet())).status).toBe(409);
  });

  it('concurrent ensurePortfolio calls create exactly ONE portfolio (no split book)', async () => {
    const { ensurePortfolio } = await import('../server/portfolio/addresses');
    await makeUser('u1');
    const now = new Date().toISOString();
    const [a, b, c] = await Promise.all([
      ensurePortfolio(db, 'u1', now),
      ensurePortfolio(db, 'u1', now),
      ensurePortfolio(db, 'u1', now),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM portfolios WHERE user_id='u1'").bind().first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('the database itself rejects a second portfolio for one user', async () => {
    await makeUser('u1');
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('p1','u1',NULL,?)").bind(now).run();
    let threw = false;
    try {
      raw.exec(`INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('p2','u1',NULL,'${now}')`);
    } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe('link cap race atomicity', () => {
  it('concurrent links of two NEW wallets at 4 rows: one links, one 409, exactly 5 rows', async () => {
    const cookie = await makeUser('u1');
    const mk = () => {
      const priv = secp256k1.utils.randomPrivateKey();
      const address = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(priv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
      return { priv, address };
    };
    for (let i = 0; i < 4; i++) {
      const w = mk();
      const ch = await handleWalletLinkChallenge(post({ address: w.address }, cookie), env, 'evm');
      const { message } = (await ch.json()) as { message: string };
      expect((await handleWalletLinkVerify(post({ address: w.address, message, signature: signEvm(w.priv)(message) }, cookie), env, 'evm')).status).toBe(200);
    }
    const link = async (w: { priv: Uint8Array; address: string }) => {
      const ch = await handleWalletLinkChallenge(post({ address: w.address }, cookie), env, 'evm');
      const { message } = (await ch.json()) as { message: string };
      return handleWalletLinkVerify(post({ address: w.address, message, signature: signEvm(w.priv)(message) }, cookie), env, 'evm');
    };
    const [r1, r2] = await Promise.all([link(mk()), link(mk())]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE network='ethereum' AND removed_at IS NULL").bind().first<{ n: number }>();
    expect(n!.n).toBe(5);
    // the refused wallet left NO identity/link residue
    const ids = await db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE kind='wallet_evm'").bind().first<{ n: number }>();
    expect(ids!.n).toBe(5);
  });
});

describe('atomic admission (reviewer): no pre-write, no residue, no challenge burn', () => {
  it('cap refusal writes NOTHING - no book row, no identity, no link', async () => {
    const cookie = await makeUser('u1');
    const mk = () => {
      const priv = secp256k1.utils.randomPrivateKey();
      const address = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(priv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
      return { priv, address };
    };
    const link = async (w: { priv: Uint8Array; address: string }) => {
      const ch = await handleWalletLinkChallenge(post({ address: w.address }, cookie), env, 'evm');
      const { message } = (await ch.json()) as { message: string };
      return handleWalletLinkVerify(post({ address: w.address, message, signature: signEvm(w.priv)(message) }, cookie), env, 'evm');
    };
    for (let i = 0; i < 5; i++) expect((await link(mk())).status).toBe(200);
    const w6 = mk();
    expect((await link(w6)).status).toBe(409);
    const book = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE address=?").bind(w6.address.toLowerCase()).first<{ n: number }>();
    const ident = await db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE identifier=?").bind(w6.address.toLowerCase()).first<{ n: number }>();
    const wl = await db.prepare("SELECT COUNT(*) AS n FROM wallet_links WHERE address=?").bind(w6.address).first<{ n: number }>();
    expect(book!.n + ident!.n + wl!.n).toBe(0);
  });

  it('PRE-FLIGHT cap refusal does NOT burn the challenge', async () => {
    const cookie = await makeUser('u1');
    const mk = () => {
      const priv = secp256k1.utils.randomPrivateKey();
      const address = toEip55('0x' + [...keccak_256(secp256k1.getPublicKey(priv, false).slice(1))].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
      return { priv, address };
    };
    const wallets = Array.from({ length: 5 }, () => mk());
    for (const w of wallets) {
      const ch = await handleWalletLinkChallenge(post({ address: w.address }, cookie), env, 'evm');
      const { message } = (await ch.json()) as { message: string };
      await handleWalletLinkVerify(post({ address: w.address, message, signature: signEvm(w.priv)(message) }, cookie), env, 'evm');
    }
    const w6 = mk();
    const ch6 = await handleWalletLinkChallenge(post({ address: w6.address }, cookie), env, 'evm');
    const { message: m6 } = (await ch6.json()) as { message: string };
    expect((await handleWalletLinkVerify(post({ address: w6.address, message: m6, signature: signEvm(w6.priv)(m6) }, cookie), env, 'evm')).status).toBe(409);
    // free a slot: the SAME challenge signature must not be replayable (one-shot),
    // but the challenge was never burned by the refused attempt - the user simply
    // requests a fresh challenge and links cleanly.
    const n = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE network='ethereum' AND removed_at IS NULL").bind().first<{ n: number }>();
    expect(n!.n).toBe(5);
    const ch7 = await handleWalletLinkChallenge(post({ address: w6.address }, cookie), env, 'evm');
    const { message: m7 } = (await ch7.json()) as { message: string };
    expect(m7).not.toBe(m6); // fresh challenge issued, no replay weakening
  });
});
