import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import {
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  type PasskeyDeps,
} from '../server/auth/webauthn';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';

// Store/binding logic tests with INJECTED fakes (see webauthn.ts header): real
// ceremony evidence is the staging runtime smoke + virtual-authenticator e2e.
const post = (body: unknown, cookie?: string, origin: string | null = 'https://preview.test'): Request =>
  new Request('https://preview.test/api/v1/auth/passkey/x', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlBytes = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Standard browser shape: Registration/AuthenticationResponseJSON nests
// clientDataJSON under .response.
const responseWithChallenge = (challenge: string, id = 'cred-1') => ({
  id,
  response: {
    clientDataJSON: b64url(JSON.stringify({ challenge, origin: 'https://preview.test', type: 'webauthn.get' })),
  },
});

let db: ReturnType<typeof createSqliteD1>['db'];
let env: NativeAuthEnv;
let deps: PasskeyDeps;
let lastOptionsChallenge: string;

beforeEach(async () => {
  ({ db } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
  deps = {
    generateRegistrationOptions: (async (o: { challenge: Uint8Array }) => {
      lastOptionsChallenge = b64urlBytes(o.challenge); // what the authenticator echoes
      return { challenge: lastOptionsChallenge };
    }) as never,
    verifyRegistrationResponse: (async (o: { expectedChallenge: string; expectedRPID: string; expectedOrigin: string }) => {
      if (o.expectedRPID !== 'preview.test' || o.expectedOrigin !== 'https://preview.test')
        throw new Error('rp/origin');
      return {
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        },
      };
    }) as never,
    generateAuthenticationOptions: (async (o: { challenge: Uint8Array }) => {
      lastOptionsChallenge = b64urlBytes(o.challenge);
      return { challenge: lastOptionsChallenge };
    }) as never,
    verifyAuthenticationResponse: (async () => ({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    })) as never,
  };
});

const makeUser = async () => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  const s = await createSession(db, 'u1');
  return `${SESSION_COOKIE}=${s.id}`;
};

describe('passkey registration (session-gated)', () => {
  it('options require a live session and bind the server challenge', async () => {
    expect((await handlePasskeyRegisterOptions(post({}), env, deps)).status).toBe(401);
    const cookie = await makeUser();
    const r = await handlePasskeyRegisterOptions(post({}, cookie), env, deps);
    expect(r.status).toBe(200);
    expect(lastOptionsChallenge).toBeTruthy();
  });
  it('verify stores credential under the session user; replay of the same challenge fails', async () => {
    const cookie = await makeUser();
    await handlePasskeyRegisterOptions(post({}, cookie), env, deps);
    const body = { response: responseWithChallenge(lastOptionsChallenge) };
    const r = await handlePasskeyRegisterVerify(post(body, cookie), env, deps);
    expect(r.status).toBe(200);
    const row = await db.prepare("SELECT user_id, metadata FROM auth_identities WHERE kind='passkey' AND identifier='cred-1'").bind().first<{ user_id: string; metadata: string }>();
    expect(row!.user_id).toBe('u1');
    expect(JSON.parse(row!.metadata).counter).toBe(0);
    // replay: same challenge already consumed
    expect((await handlePasskeyRegisterVerify(post(body, cookie), env, deps)).status).toBe(401);
  });
  it('duplicate credential id returns safe 409, not 500 (D1 UNIQUE throw caught)', async () => {
    const cookie = await makeUser();
    // pre-existing credential with the same id (any user)
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at, metadata) VALUES ('x','u1','passkey','cred-1',?,'{}')")
      .bind(now)
      .run();
    await handlePasskeyRegisterOptions(post({}, cookie), env, deps);
    const r = await handlePasskeyRegisterVerify(
      post({ response: responseWithChallenge(lastOptionsChallenge) }, cookie), env, deps);
    expect(r.status).toBe(409);
    expect((await r.json() as { error: string }).error).toBe('credential_exists');
  });
  it('a challenge issued to one user cannot be claimed by another', async () => {
    const cookie = await makeUser();
    await handlePasskeyRegisterOptions(post({}, cookie), env, deps);
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u2','active',?,?)").bind(now, now).run();
    const s2 = await createSession(db, 'u2');
    const r = await handlePasskeyRegisterVerify(
      post({ response: responseWithChallenge(lastOptionsChallenge) }, `${SESSION_COOKIE}=${s2.id}`), env, deps);
    expect(r.status).toBe(401);
  });
});

describe('passkey login', () => {
  it('full round trip: options -> verify -> session, counter advances; unknown credential and replay rejected', async () => {
    const cookie = await makeUser();
    await handlePasskeyRegisterOptions(post({}, cookie), env, deps);
    await handlePasskeyRegisterVerify(post({ response: responseWithChallenge(lastOptionsChallenge) }, cookie), env, deps);

    const opts = await handlePasskeyLoginOptions(post({}), env, deps);
    expect(opts.status).toBe(200);
    const { challengeId } = (await opts.json()) as { challengeId: string };
    const loginBody = { challengeId, response: responseWithChallenge(lastOptionsChallenge) };
    const r = await handlePasskeyLoginVerify(post(loginBody), env, deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('__Host-sola_session=');
    const meta = JSON.parse(
      (await db.prepare("SELECT metadata FROM auth_identities WHERE identifier='cred-1'").bind().first<{ metadata: string }>())!.metadata,
    );
    expect(meta.counter).toBe(7); // advanced from 0
    // replay: challenge consumed
    expect((await handlePasskeyLoginVerify(post(loginBody), env, deps)).status).toBe(401);
    // unknown credential
    const opts2 = await handlePasskeyLoginOptions(post({}), env, deps);
    const c2 = ((await opts2.json()) as { challengeId: string }).challengeId;
    const unk = await handlePasskeyLoginVerify(
      post({ challengeId: c2, response: responseWithChallenge(lastOptionsChallenge, 'nope') }), env, deps);
    expect(unk.status).toBe(401);
    expect(((await unk.json()) as { error: string }).error).toBe('unknown_credential');
  });
  it('foreign origin and disabled flag are rejected', async () => {
    expect((await handlePasskeyLoginOptions(post({}, undefined, 'https://evil.test'), env, deps)).status).toBe(403);
    env.NATIVE_AUTH_ENABLED = 'false';
    expect((await handlePasskeyLoginOptions(post({}), env, deps)).status).toBe(503);
  });
});
