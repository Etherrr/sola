/**
 * Passkey (WebAuthn) handlers (v0.2 preview, UNWIRED - no functions routes yet).
 *
 * - Registration is session-gated (flow A: email-verified user adds a passkey).
 * - Login is discoverable-credential: challenge subject is a per-request id the
 *   client echoes back, so concurrent logins never supersede each other.
 * - Credential storage: auth_identities(kind='passkey', identifier=credentialID
 *   base64url, metadata JSON {publicKey, counter, transports}) - no new table.
 * - Single-use: the clientDataJSON challenge must be an issued, unconsumed,
 *   unexpired challenge claimed by THIS request's attempt id (claim-then-verify;
 *   a failed cryptographic verification after a successful claim burns the
 *   challenge - fail closed, same rule as crash-after-claim).
 * - Verification is INJECTED (default @simplewebauthn/server): local tests drive
 *   the store/binding logic with fakes; REAL-ceremony evidence comes from the
 *   staging Workers runtime smoke + a virtual-authenticator e2e (pending the
 *   route-wiring gate) - never claimed from these tests.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import {
  claimChallenge,
  issueChallenge,
  type ChallengeDb,
} from './challenges';
import { createSession, readLiveSession } from './sessions';
import { requireSameOrigin } from './guards';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';
import { readSessionCookie, SESSION_COOKIE, type NativeAuthEnv } from './email';

const TTL_MS = 5 * 60 * 1000;
const SESSION_MAX_AGE_S = 14 * 24 * 3600;
const LOGIN_WINDOWS: LimitWindow[] = [{ limit: 10, windowMs: 600_000 }];

export interface PasskeyDeps {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: (opts: {
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
  }) => Promise<VerifiedRegistrationResponse>;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: (opts: {
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRPID: string;
    credential: { id: string; publicKey: Uint8Array; counter: number };
  }) => Promise<VerifiedAuthenticationResponse>;
}

const defaultDeps: PasskeyDeps = {
  generateRegistrationOptions,
  verifyRegistrationResponse: (o) =>
    verifyRegistrationResponse(o as Parameters<typeof verifyRegistrationResponse>[0]),
  generateAuthenticationOptions,
  verifyAuthenticationResponse: (o) =>
    verifyAuthenticationResponse(o as Parameters<typeof verifyAuthenticationResponse>[0]),
};

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const rpOf = (req: Request) => {
  const url = new URL(req.url);
  return { rpID: url.hostname, origin: url.origin };
};

interface CredentialMeta {
  publicKey: string; // base64url
  counter: number;
  transports?: string[];
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The WebAuthn challenge secret = base64url of 32 random bytes. The BYTES are
 *  handed to simplewebauthn; the authenticator echoes exactly this base64url
 *  string in clientDataJSON, so the stored secret_hash matches the claim value. */
function newWebauthnChallenge(): { bytes: Uint8Array<ArrayBuffer>; b64: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  return { bytes, b64: b64url(bytes) };
}

/** Extract the clientDataJSON challenge WITHOUT trusting it - it only locates
 *  the server-issued challenge to claim; cryptographic checks come after.
 *  `response` is the full Registration/AuthenticationResponseJSON whose nested
 *  .response.clientDataJSON carries the challenge (standard browser shape). */
function clientChallenge(response: { response?: { clientDataJSON?: string } } | null): string | null {
  try {
    const raw = (response as { response: { clientDataJSON: string } }).response.clientDataJSON;
    const jsonStr = new TextDecoder().decode(fromB64url(raw));
    const parsed = JSON.parse(jsonStr) as { challenge?: string };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

async function liveUser(req: Request, db: ChallengeDb): Promise<string | Response> {
  const id = readSessionCookie(req);
  if (!id) return json(401, { error: 'auth_required' });
  const session = await readLiveSession(db, id);
  if (!session) return json(401, { error: 'session_expired' });
  return session.user_id;
}

export async function handlePasskeyRegisterOptions(
  req: Request,
  env: NativeAuthEnv,
  deps: PasskeyDeps = defaultDeps,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const user = await liveUser(req, db);
  if (user instanceof Response) return user;
  const { rpID, origin } = rpOf(req);
  const wc = newWebauthnChallenge();
  const issued = await issueChallenge(db, 'webauthn_register', user, TTL_MS, new Date(), wc.b64);
  const options = await deps.generateRegistrationOptions({
    rpName: 'Sola',
    rpID,
    userName: user,
    challenge: wc.bytes,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  return json(200, { status: 'ok', options, expiresAt: issued.expiresAt, origin, requestId });
}

export async function handlePasskeyRegisterVerify(
  req: Request,
  env: NativeAuthEnv,
  deps: PasskeyDeps = defaultDeps,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const user = await liveUser(req, db);
  if (user instanceof Response) return user;
  const body = (await req.json().catch(() => null)) as {
    response?: { response?: { clientDataJSON?: string } };
  } | null;
  if (!body?.response?.response?.clientDataJSON) return json(400, { error: 'invalid_request', requestId });
  const challenge = clientChallenge(body.response);
  if (!challenge) return json(400, { error: 'invalid_request', requestId });

  const attemptId = crypto.randomUUID();
  const won = await claimChallenge(db, 'webauthn_register', user, challenge, attemptId);
  if (!won) return json(401, { error: 'invalid_or_consumed_challenge', requestId });

  const { rpID, origin } = rpOf(req);
  let verified: VerifiedRegistrationResponse;
  try {
    verified = await deps.verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return json(401, { error: 'verification_failed', requestId });
  }
  const reg = verified.registrationInfo;
  if (!verified.verified || !reg) return json(401, { error: 'verification_failed', requestId });
  const meta: CredentialMeta = {
    publicKey: b64url(reg.credential.publicKey),
    counter: reg.credential.counter,
    transports: reg.credential.transports,
  };
  // Duplicate credential id: D1 throws on the UNIQUE(kind, identifier)
  // constraint rather than returning success:false - catch it so a replayed
  // registration gets a safe 409 instead of a 500. The challenge stays
  // consumed (claim happened above), which is fail-closed and correct.
  try {
    await db
      .prepare(
        `INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at, metadata)
         VALUES (?, ?, 'passkey', ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), user, reg.credential.id, new Date().toISOString(), JSON.stringify(meta))
      .run();
  } catch (e) {
    // Only the UNIQUE constraint conflict is a safe 409; other DB failures
    // must not be masked as conflicts.
    if (e instanceof Error && /unique/i.test(e.message))
      return json(409, { error: 'credential_exists', requestId });
    throw e;
  }
  return json(200, { status: 'ok', credentialId: reg.credential.id, requestId });
}

export async function handlePasskeyLoginOptions(
  req: Request,
  env: NativeAuthEnv,
  deps: PasskeyDeps = defaultDeps,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const { rpID } = rpOf(req);
  // Per-request subject: concurrent logins never supersede each other's challenge.
  const challengeId = crypto.randomUUID();
  const limiter = createD1Limiter(db as never, LOGIN_WINDOWS, 'auth_passkey_login');
  const lim = await limiter.check(req.headers.get('cf-connecting-ip') ?? 'unknown');
  if (!lim.allowed)
    return json(429, { error: 'rate_limited', retryAfterSec: lim.retryAfterSec, requestId });
  const wc = newWebauthnChallenge();
  const issued = await issueChallenge(db, 'webauthn_login', challengeId, TTL_MS, new Date(), wc.b64);
  const options = await deps.generateAuthenticationOptions({
    rpID,
    challenge: wc.bytes,
    userVerification: 'preferred',
  });
  return json(200, { status: 'ok', challengeId, options, expiresAt: issued.expiresAt, requestId });
}

export async function handlePasskeyLoginVerify(
  req: Request,
  env: NativeAuthEnv,
  deps: PasskeyDeps = defaultDeps,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const body = (await req.json().catch(() => null)) as {
    challengeId?: string;
    response?: { id?: string; response?: { clientDataJSON?: string } };
  } | null;
  if (!body?.challengeId || !body?.response?.id) return json(400, { error: 'invalid_request', requestId });
  const challenge = clientChallenge(body.response);
  if (!challenge) return json(400, { error: 'invalid_request', requestId });

  const cred = await db
    .prepare(`SELECT user_id, metadata FROM auth_identities WHERE kind = 'passkey' AND identifier = ?`)
    .bind(body.response.id)
    .first<{ user_id: string; metadata: string | null }>();
  if (!cred || !cred.metadata) return json(401, { error: 'unknown_credential', requestId });
  const meta = JSON.parse(cred.metadata) as CredentialMeta;

  const attemptId = crypto.randomUUID();
  const won = await claimChallenge(db, 'webauthn_login', body.challengeId, challenge, attemptId);
  if (!won) return json(401, { error: 'invalid_or_consumed_challenge', requestId });

  const { rpID, origin } = rpOf(req);
  let verified: VerifiedAuthenticationResponse;
  try {
    verified = await deps.verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: body.response.id,
        publicKey: fromB64url(meta.publicKey),
        counter: meta.counter,
      },
    });
  } catch {
    return json(401, { error: 'verification_failed', requestId });
  }
  if (!verified.verified) return json(401, { error: 'verification_failed', requestId });
  // Counter advances on every successful assertion (clone detection upstream).
  await db
    .prepare(`UPDATE auth_identities SET metadata = ? WHERE kind = 'passkey' AND identifier = ?`)
    .bind(
      JSON.stringify({ ...meta, counter: verified.authenticationInfo.newCounter }),
      body.response.id,
    )
    .run();
  const session = await createSession(db, cred.user_id);
  const cookie =
    `${SESSION_COOKIE}=${session.id}; Path=/; Max-Age=${SESSION_MAX_AGE_S};` +
    ' HttpOnly; Secure; SameSite=Lax';
  return json(200, { status: 'ok', user: { id: cred.user_id }, requestId }, { 'set-cookie': cookie });
}
