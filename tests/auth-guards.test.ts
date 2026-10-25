import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { requireSameOrigin, requireNativeSession } from '../server/auth/guards';
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

describe('requireNativeSession (entitlement middleware)', () => {
  it('401 without cookie, 401 on revoked/expired, identity on live session', async () => {
    const { db } = createSqliteD1();
    const noCookie = await requireNativeSession(new Request('https://app.test/x'), db);
    expect(noCookie).toBeInstanceOf(Response);
    await db
      .prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('user-1','active','2026-01-01','2026-01-01')")
      .bind().run();
    const s = await createSession(db, 'user-1');
    const authed = await requireNativeSession(
      new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=${s.id}` } }),
      db,
    );
    expect(authed).not.toBeInstanceOf(Response);
    expect((authed as { userId: string }).userId).toBe('user-1');
    const bogus = await requireNativeSession(
      new Request('https://app.test/x', { headers: { cookie: `${SESSION_COOKIE}=nope` } }),
      db,
    );
    expect(bogus).toBeInstanceOf(Response);
  });
});
