// TEST-ONLY UI harness: serves the REAL production static export (proxied from
// 127.0.0.1:3099) and the REAL reviewed passkey + session-info handlers over
// one origin (https://localhost:8787), so the actual browser client
// (features/auth-v2/passkey-client.ts through the real sign-in form and
// account menu) drives genuine WebAuthn ceremonies against a virtual
// authenticator. Never shipped: no functions/ route, no production config.
import { createServer } from 'node:https';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onRequest as middleware } from '../functions/_middleware';
import {
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
} from '../server/auth/webauthn';
import { handleNativeSessionInfo } from '../server/auth/session-info';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import { createSqliteD1 } from '../tests/helpers/d1-sqlite';

const { db, raw } = createSqliteD1();
const env: NativeAuthEnv = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
const DEV = 'http://127.0.0.1:3099';

const postRoutes: Record<string, (req: Request) => Promise<Response>> = {
  '/api/v1/auth/passkey/register/options': (req) => handlePasskeyRegisterOptions(req, env),
  '/api/v1/auth/passkey/register/verify': (req) => handlePasskeyRegisterVerify(req, env),
  '/api/v1/auth/passkey/login/options': (req) => handlePasskeyLoginOptions(req, env),
  '/api/v1/auth/passkey/login/verify': (req) => handlePasskeyLoginVerify(req, env),
};
const getRoutes: Record<string, (req: Request) => Promise<Response>> = {
  '/api/v1/auth/email/session': (req) => handleNativeSessionInfo(req, env),
};

export function startUiHarness(port = 8787): Promise<import('node:https').Server> {
  const dir = mkdtempSync(join(tmpdir(), 'sola-passkey-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  const server = createServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    async (nreq, nres) => {
      const url = new URL(nreq.url ?? '/', 'https://localhost');
      const origin = `https://${nreq.headers.host}`;
      const cookie = nreq.headers.cookie ?? '';

      if (url.pathname === '/__test/session' && nreq.method === 'POST') {
        const now = new Date().toISOString();
        await db
          .prepare(
            "INSERT OR IGNORE INTO users (id, status, created_at, updated_at) VALUES ('e2e-user','active',?,?)",
          )
          .bind(now, now)
          .run();
        await db
          .prepare(
            "INSERT OR IGNORE INTO auth_identities (id, user_id, kind, identifier, verified_at, metadata) VALUES ('e2e-email','e2e-user','email','e2e@preview.test',?,'{}')",
          )
          .bind(now)
          .run();
        await db
          .prepare(
            "INSERT OR IGNORE INTO entitlements (id,email,granted_by,created_at) VALUES ('e2e-invite','e2e@preview.test','local-fixture',?)",
          )
          .bind(now)
          .run();
        const s = await createSession(db, 'e2e-user');
        nres.writeHead(200, {
          'set-cookie': `${SESSION_COOKIE}=${s.id}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          'content-type': 'application/json',
        });
        return nres.end('{"ok":true}');
      }
      if (url.pathname === '/__test/backdate' && nreq.method === 'POST') {
        await db
          .prepare('UPDATE sessions SET created_at = ? WHERE revoked_at IS NULL')
          .bind(new Date(Date.now() - 30 * 60 * 1000).toISOString())
          .run();
        nres.writeHead(200, { 'content-type': 'application/json' });
        return nres.end('{"ok":true}');
      }

      const admission = await middleware({
        request: new Request(`${origin}${url.pathname}${url.search}`, {
          method: nreq.method,
          headers: { ...(nreq.headers as Record<string, string>) },
        }),
        env,
        next: async () => new Response(null, { status: 204 }),
      });
      if (admission.status !== 204) {
        nres.writeHead(admission.status, Object.fromEntries(admission.headers));
        return nres.end(await admission.text());
      }
      const handler = nreq.method === 'POST' ? postRoutes[url.pathname] : getRoutes[url.pathname];
      if (handler) {
        const chunks: Buffer[] = [];
        for await (const c of nreq) chunks.push(c as Buffer);
        const req = new Request(`${origin}${url.pathname}`, {
          method: nreq.method,
          headers: { 'content-type': 'application/json', origin, cookie },
          body: nreq.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });
        const res = await handler(req);
        nres.writeHead(res.status, {
          'content-type': 'application/json',
          ...(res.headers.get('set-cookie')
            ? { 'set-cookie': res.headers.get('set-cookie')! }
            : {}),
        });
        return nres.end(await res.text());
      }

      // Everything else: proxy the real static export.
      try {
        const upstream = await fetch(`${DEV}${url.pathname}${url.search}`, {
          headers: { cookie },
          redirect: 'manual',
        });
        const location = upstream.headers.get('location');
        if (location) {
          nres.writeHead(upstream.status, { location });
          return nres.end();
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        const headers: Record<string, string> = {};
        const ct = upstream.headers.get('content-type');
        if (ct) headers['content-type'] = ct;
        nres.writeHead(upstream.status, headers);
        return nres.end(body);
      } catch (e) {
        nres.writeHead(502);
        return nres.end('static export unreachable: ' + String(e));
      }
    },
  );

  server.on('close', () => {
    rmSync(dir, { recursive: true, force: true });
    raw.close();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`ui harness on https://localhost:${port}`);
      resolve(server);
    });
  });
}
