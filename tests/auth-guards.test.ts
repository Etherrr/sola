import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { requireSameOrigin, requireLiveSession, requireEntitledSession } from '../server/auth/guards';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';

const post = (origin: string | null) =>
  new Request('https://app.test/api/v1/auth/email/verify', {
    method: 'POST',
    ...(origin ? { headers: { origin } } : {}),
  });

describe('requireSameOrigin', () => {
  it('allows same-origin, rejects foreign/missing/malformed', () => {
    expect(requireSameOrigin(post('https://app.test'))).toBeNull();
    expect(requireSameOrigin(post('https://evil.test'))).toBeInstanceOf(Response);
    expect(requireSameOrigin(post(null))).toBeInstanceOf(Response);
    expect(requireSameOrigin(post('not a url'))).toBeInstanceOf(Response);
    // subdomain is a different host: rejected (strict)
    expect(requireSameOrigin(post('https://sub.app.test'))).toBeInstanceOf(Response);
  });
});

describe('requireLiveSession (session guard, NOT entitlement)', () => {
  it('401 without cookie, 401 on revoked/expired/bogus, identity on live session', async () => {
    const { db } = createSqliteD1();
    const noCookie = await requireLiveSession(new Request('https://app.test/x'), db);
    expect(noCookie).toBeInstanceOf(Response);
    await db
      .prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('user-1','active','2026-01-01','2026-01-01')")
      .bind().run();
    const s = await createSession(db, 'user-1');
    const authed = await requireLiveSession(
      new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=${s.id}` } }),
      db,
    );
    expect(authed).not.toBeInstanceOf(Response);
    expect((authed as { userId: string }).userId).toBe('user-1');
    const bogus = await requireLiveSession(
      new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=nope` } }),
      db,
    );
    expect(bogus).toBeInstanceOf(Response);
  });
});

describe('requireEntitledSession (the real data gate)', () => {
  const setup = async () => {
    const { db } = createSqliteD1();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(now).run();
    const s = await createSession(db, 'u1');
    const req = () => new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=${s.id}` } });
    return { db, req, now };
  };
  it('403 without an entitlement row (invite rejection)', async () => {
    const { db, req } = await setup();
    const r = await requireEntitledSession(req(), db);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(403);
    expect(((await (r as Response).json()) as { error: string }).error).toBe('not_entitled');
  });
  it('403 when the only entitlement is revoked', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at, revoked_at) VALUES ('e1','invited@x.co','owner',?,?)").bind(now, now).run();
    const r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
  });
  it('403 when the entitlement names a different email', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','other@x.co','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
  });
  it('passes with an active entitlement for the verified email', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
    expect((r as { userId: string }).userId).toBe('u1');
  });
});

describe('requireEntitledSession hardening (reviewer 2026-10-25)', () => {
  const setup = async () => {
    const { db } = createSqliteD1();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','Invited@X.co',?)").bind(now).run();
    const s = await createSession(db, 'u1');
    const req = () => new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=${s.id}` } });
    return { db, req, now };
  };
  it('matches case-insensitively (mixed-case identity vs lowercase entitlement)', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
  });
  it('matches ANY verified email identity, not only the latest', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i2','u1','email','second@x.co',?)").bind(now).run();
    // entitlement names the OLDER identity; latest-only matching would 403
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
  });
  it('wallet path: verified wallet_evm identity matches ethereum entitlement case-insensitively', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('w1','u1','wallet_evm','0xAbCDEF0000000000000000000000000000000001',?)").bind(now).run();
    await db.prepare("INSERT INTO entitlements (id, wallet_chain, wallet_address, granted_by, created_at) VALUES ('e2','ethereum','0xabcdef0000000000000000000000000000000001','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
  });
  it('wallet negatives: wrong chain, wrong address, revoked all 403', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('w1','u1','wallet_evm','0xabc1',?)").bind(now).run();
    // wrong chain
    await db.prepare("INSERT INTO entitlements (id, wallet_chain, wallet_address, granted_by, created_at) VALUES ('e2','solana','0xabc1','owner',?)").bind(now).run();
    let r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
    // wrong address, right chain
    await db.prepare("UPDATE entitlements SET wallet_chain='ethereum', wallet_address='0xDEAD'").bind().run();
    r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
    // revoked match
    await db.prepare("UPDATE entitlements SET wallet_address='0xabc1', revoked_at=?").bind(now).run();
    r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
  });
  it('wallet identity does NOT match an email-only entitlement and vice versa', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('w1','u1','wallet_evm','0xabc1',?)").bind(now).run();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','someone-else@x.co','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
  });
});

describe('wallet chain-specific canonical matching (reviewer 2026-10-25)', () => {
  const setup = async () => {
    const { db } = createSqliteD1();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(now).run();
    const s = await createSession(db, 'u1');
    const req = () => new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=${s.id}` } });
    return { db, req, now };
  };
  it('EVM: case-differing hex address still matches', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('w1','u1','wallet_evm','0xABCDEF12',?)").bind(now).run();
    await db.prepare("INSERT INTO entitlements (id, wallet_chain, wallet_address, granted_by, created_at) VALUES ('e2','ethereum','0xabcdef12','owner',?)").bind(now).run();
    const r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
  });
  it('Solana: base58 is case-sensitive - case-differing address must NOT match', async () => {
    const { db, req, now } = await setup();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('w1','u1','wallet_solana','SoL4NaAdDrEsS',?)").bind(now).run();
    await db.prepare("INSERT INTO entitlements (id, wallet_chain, wallet_address, granted_by, created_at) VALUES ('e2','solana','sol4naaddress','owner',?)").bind(now).run();
    let r = await requireEntitledSession(req(), db);
    expect((r as Response).status).toBe(403);
    // exact case match passes
    await db.prepare("UPDATE entitlements SET wallet_address='SoL4NaAdDrEsS'").bind().run();
    r = await requireEntitledSession(req(), db);
    expect(r).not.toBeInstanceOf(Response);
  });
});
