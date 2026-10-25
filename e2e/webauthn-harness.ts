// TEST-ONLY local harness for the virtual-authenticator WebAuthn e2e. Never
// shipped: no functions/ route, no production config. Wires the REAL handlers
// with defaultDeps (genuine @simplewebauthn/server verification) against the
// in-memory sqlite D1, over http://localhost (a secure context for WebAuthn).
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import {
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
} from '../server/auth/webauthn';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import { createSqliteD1 } from '../tests/helpers/d1-sqlite';

const { db } = createSqliteD1();
const env: NativeAuthEnv = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };

const PAGE = `<!doctype html><html><body><pre id="out"></pre><script>
const out = (o) => { document.getElementById('out').textContent = JSON.stringify(o); };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)).buffer;
const inflate = (pk) => { const o = JSON.parse(JSON.stringify(pk));
  o.challenge = unb64(o.challenge); if (o.user) o.user.id = unb64(o.user.id);
  if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map(c => ({...c, id: unb64(c.id)}));
  if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map(c => ({...c, id: unb64(c.id)}));
  return o; };
const deflate = (cred) => { const r = cred.response; const cdj = b64(r.clientDataJSON);
  try { console.log('CDJ', new TextDecoder().decode(r.clientDataJSON).slice(0,200), 'OPTCH', window.__optChallenge); } catch(e){}
  const o = { id: cred.id, rawId: b64(cred.rawId), type: cred.type,
  response: { clientDataJSON: cdj } };
  if (r.attestationObject) o.response.attestationObject = b64(r.attestationObject);
  if (r.authenticatorData) o.response.authenticatorData = b64(r.authenticatorData);
  if (r.signature) o.response.signature = b64(r.signature);
  if (r.userHandle) o.response.userHandle = b64(r.userHandle);
  return o; };
const j = (p, body) => fetch(p, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body ?? {}) });
window.runRegister = async () => { try {
  await j('/__test/session');
  const optRes = await j('/api/v1/auth/passkey/register/options');
  const opt = await optRes.json();
  if (!opt.options) { out({ pageError: 'options failed', status: optRes.status, opt }); return; }
  window.__optChallenge = opt.options.challenge;
  const cred = await navigator.credentials.create({ publicKey: inflate(opt.options) });
  if (!cred) { out({ pageError: 'create returned null', opt }); return; }
  const v = await j('/api/v1/auth/passkey/register/verify', { response: deflate(cred) });
  out({ status: v.status, body: await v.json() });
} catch (e) { out({ pageError: String(e) }); } };
window.runLogin = async () => { try {
  const opt = await (await j('/api/v1/auth/passkey/login/options')).json();
  const asrt = await navigator.credentials.get({ publicKey: inflate(opt.options) });
  const v = await j('/api/v1/auth/passkey/login/verify', { challengeId: opt.challengeId, response: deflate(asrt) });
  out({ status: v.status, body: await v.json(), setCookie: v.headers.get('set-cookie') ? 'yes' : 'no' });
} catch (e) { out({ pageError: String(e) }); } };
</script></body></html>`;

const routes: Record<string, (req: Request) => Promise<Response>> = {
  '/api/v1/auth/passkey/register/options': (req) => handlePasskeyRegisterOptions(req, env),
  '/api/v1/auth/passkey/register/verify': (req) => handlePasskeyRegisterVerify(req, env),
  '/api/v1/auth/passkey/login/options': (req) => handlePasskeyLoginOptions(req, env),
  '/api/v1/auth/passkey/login/verify': (req) => handlePasskeyLoginVerify(req, env),
};

const server = createServer(
  { key: readFileSync('/tmp/hk.pem'), cert: readFileSync('/tmp/hc.pem') },
  async (nreq, nres) => {
  const url = new URL(nreq.url ?? '/', 'https://localhost');
  if (url.pathname === '/' && nreq.method === 'GET') {
    nres.writeHead(200, { 'content-type': 'text/html' });
    return nres.end(PAGE);
  }
  if (url.pathname === '/__test/session' && nreq.method === 'POST') {
    const now = new Date().toISOString();
    await db.prepare("INSERT OR IGNORE INTO users (id, status, created_at, updated_at) VALUES ('e2e-user','active',?,?)").bind(now, now).run();
    const s = await createSession(db, 'e2e-user');
    nres.writeHead(200, { 'set-cookie': `${SESSION_COOKIE}=${s.id}; Path=/; HttpOnly; Secure; SameSite=Lax`, 'content-type': 'application/json' });
    return nres.end('{"ok":true}');
  }
  const handler = routes[url.pathname];
  if (!handler || nreq.method !== 'POST') {
    nres.writeHead(404); return nres.end();
  }
  const chunks: Buffer[] = [];
  for await (const c of nreq) chunks.push(c as Buffer);
  const cookie = nreq.headers.cookie ?? '';
  const origin = `https://${nreq.headers.host}`;
  const req = new Request(`${origin}${url.pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie },
    body: Buffer.concat(chunks),
  });
  if (url.pathname.includes('verify')) {
    try {
      const peek = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const r0 = peek.response ?? {};
      console.error('DBG', url.pathname, 'keys', Object.keys(peek), 'respKeys', Object.keys(r0), 'cdj', typeof r0.clientDataJSON, (r0.clientDataJSON||'').length, 'challengeId', peek.challengeId);
    } catch (e) { console.error('DBG parse fail', String(e)); }
  }
  const res = await handler(req);
  nres.writeHead(res.status, { 'content-type': 'application/json', ...(res.headers.get('set-cookie') ? { 'set-cookie': res.headers.get('set-cookie')! } : {}) });
  nres.end(await res.text());
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, '127.0.0.1', () => console.log(`harness on https://localhost:${port}`));
