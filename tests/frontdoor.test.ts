import { describe, it, expect } from 'vitest';
import { frontdoorAdmission, type FrontdoorEnv } from '../server/frontdoor/admission';
import { onRequest } from '../functions/_middleware';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import routes from '../public/_routes.json';
const setup = async () => {
  const { db, raw } = createSqliteD1();
  const now = new Date().toISOString();
  raw.exec(
    `INSERT INTO users VALUES ('u','active','${now}','${now}'); INSERT INTO auth_identities(id,user_id,kind,identifier,verified_at) VALUES ('i','u','email','qa@example.test','${now}'); INSERT INTO entitlements(id,email,granted_by,created_at) VALUES ('e','qa@example.test','test','${now}');`,
  );
  const session = await createSession(db, 'u');
  const env: FrontdoorEnv = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
  const req = (path: string, cookie = session.id, init: RequestInit = {}) =>
    new Request('https://app.test' + path, {
      ...init,
      headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${cookie}`, ...init.headers },
    });
  return { raw, env, req };
};
describe('native frontdoor admission before assets', () => {
  it('all routes invoke middleware; no static exclusion can bypass data gate', () =>
    expect(routes).toEqual({ version: 1, include: ['/*'], exclude: [] }));
  it('public auth/education shells work with flags off, no DB lookup', async () => {
    for (const p of [
      '/',
      '/sign-in/',
      '/create-account/',
      '/learn/',
      '/learn/security/',
      '/start/',
      '/education/',
      '/_next/static/chunks/abc.js',
      '/sola-monogram.png',
    ])
      expect(await frontdoorAdmission(new Request('https://app.test' + p), {})).toBeNull();
  });
  it('live entitled session admits page aliases, HTML exports and protected RSC data', async () => {
    const { env, req } = await setup();
    for (const p of [
      '/account',
      '/account/',
      '/account/index.html',
      '/portfolio/',
      '/demo/',
      '/demo/assets/',
      '/demo/positions/',
      '/demo/risk/',
      '/portfolio/assets.html',
      '/account/index.txt',
      '/unknown/path',
    ])
      expect(await frontdoorAdmission(req(p), env)).toBeNull();
  });
  it('no session, cookie spoof, expired and revoked session deny before static response', async () => {
    const { env, req, raw } = await setup();
    for (const p of [
      '/account/',
      '/account/overview/',
      '/account/assets/',
      '/account/defi/',
      '/account/risk/',
      '/portfolio/assets/',
      '/demo/',
      '/demo/assets/',
      '/demo/positions/',
      '/demo/risk/',
      '/_next/data/build/account.json',
      '/_next/static/private.json',
    ]) {
      const r = await frontdoorAdmission(req(p, 'bogus'), env);
      expect(r?.status).toBe(302);
      expect(r?.headers.get('location')).toMatch(/^\/sign-in\/\?next=%2F/);
    }
    raw.exec("UPDATE sessions SET expires_at='2000-01-01'");
    expect((await frontdoorAdmission(req('/account/'), env))?.status).toBe(302);
    raw.exec("UPDATE sessions SET expires_at='2099-01-01',revoked_at='2026-01-01'");
    expect((await frontdoorAdmission(req('/account/'), env))?.status).toBe(302);
  });
  it('uninvited and revoked entitlements give nonlooping 403, never sign-in redirect', async () => {
    const { env, req, raw } = await setup();
    raw.exec("UPDATE entitlements SET revoked_at='2026-01-01'");
    const r = await frontdoorAdmission(req('/account/'), env);
    expect(r?.status).toBe(403);
    expect(r?.headers.has('location')).toBe(false);
    expect(r?.headers.get('content-type')).toContain('text/html');
    expect(r?.headers.get('cache-control')).toBe('no-store');
    const body = await r!.text();
    expect(body).toContain('href="/sign-in/"');
    expect(body).not.toContain('private');
    const data = await frontdoorAdmission(req('/account/index.txt'), env);
    const json = await frontdoorAdmission(req('/account/data.json'), env);
    expect(json?.headers.get('content-type')).toContain('text/plain');
    const nonHtml = await frontdoorAdmission(
      req('/account/', undefined, { headers: { accept: 'application/json' } }),
      env,
    );
    expect(nonHtml?.headers.get('content-type')).toContain('text/plain');
    expect(data?.status).toBe(403);
    expect(data?.headers.get('content-type')).toContain('text/plain');
    expect(await data?.text()).not.toContain('<html');
    raw.exec('DELETE FROM entitlements');
    expect((await frontdoorAdmission(req('/account/'), env))?.status).toBe(403);
  });
  it('flag off, missing binding and DB failure deny, including cached-looking requests', async () => {
    const { env, req } = await setup();
    for (const e of [
      { ...env, NATIVE_AUTH_ENABLED: 'false' },
      { NATIVE_AUTH_ENABLED: 'true' },
      {
        ...env,
        PORTFOLIO_ACCOUNTS_DB: {
          prepare() {
            throw new Error('offline');
          },
        } as never,
      },
    ])
      expect((await frontdoorAdmission(req('/account/'), e))?.status).toBe(503);
  });
  it('encoded/repeated paths, non-page methods, dev surfaces and RSC cannot bypass', async () => {
    const { env, req } = await setup();
    for (const p of ['/account%2f', '/%61ccount/', '/account//'])
      expect((await frontdoorAdmission(req(p), env))?.status).toBe(400);
    expect(await frontdoorAdmission(req('/learn/%2e/account/'), env)).toBeNull(); // URL canonicalization yields /learn/account, still public Education.
    expect((await frontdoorAdmission(req('/dev/claim'), env))?.status).toBe(404);
    expect(
      (await frontdoorAdmission(req('/account/', 'bogus', { method: 'POST' }), env))?.status,
    ).toBe(405);
    for (const p of ['/account/index.txt', '/account/?_rsc=abc'])
      expect(
        (await frontdoorAdmission(req(p, 'bogus', { headers: { rsc: '1' } }), env))?.status,
      ).toBe(401);
    const r = await frontdoorAdmission(req('/account/?next=https://evil.test', 'bogus'), env);
    expect(r?.headers.get('location')).toBe(
      '/sign-in/?next=%2Faccount%2F%3Fnext%3Dhttps%3A%2F%2Fevil.test',
    );
  });
  it('API handlers preserve JSON contracts and methods, no middleware HTML redirect', async () => {
    for (const p of [
      '/api/v1/auth/email/verify',
      '/api/v1/claim/attempt',
      '/api/v1/portfolio/addresses',
    ])
      expect(
        await frontdoorAdmission(new Request('https://app.test' + p, { method: 'POST' }), {}),
      ).toBeNull();
  });
  it('actual mount never calls next on blocked pages and marks admitted pages no-store', async () => {
    const { env, req } = await setup();
    let calls = 0;
    const next = async () => {
      calls++;
      return new Response('private', { headers: { 'cache-control': 'public,max-age=3600' } });
    };
    expect((await onRequest({ request: req('/account/', 'bogus'), env, next })).status).toBe(302);
    expect(calls).toBe(0);
    const r = await onRequest({ request: req('/account/'), env, next });
    expect(calls).toBe(1);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
