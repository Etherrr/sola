'use client';
import {
  passkeyRegisterOptionsRequest,
  passkeyRegisterVerifyRequest,
  passkeyLoginOptionsRequest,
  passkeyLoginVerifyRequest,
} from '../portfolio/api-client';

/**
 * Browser half of the passkey (WebAuthn) ceremonies. The four HTTP requests go
 * through api-client.ts (the only approved request module); this file only
 * converts server options to the binary shape navigator.credentials wants and
 * back. No wallet or signing APIs here - passkeys only, and sign-in is a
 * message ceremony, never a transaction.
 */

export type PasskeyOutcome =
  | { ok: true }
  | { ok: false; message: string };

const b64 = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64 = (s: string): ArrayBuffer =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;

type OptionsJson = {
  challenge: string;
  user?: { id: string };
  excludeCredentials?: Array<{ id: string }>;
  allowCredentials?: Array<{ id: string }>;
} & Record<string, unknown>;

/** Server options arrive base64url-JSON; navigator.credentials wants ArrayBuffers. */
const inflate = (o: OptionsJson): PublicKeyCredentialCreationOptions & PublicKeyCredentialRequestOptions => {
  const copy: OptionsJson = JSON.parse(JSON.stringify(o));
  copy.challenge = unb64(o.challenge) as unknown as string;
  if (o.user?.id) (copy.user as { id: unknown }).id = unb64(o.user.id);
  if (o.excludeCredentials)
    copy.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: unb64(c.id) as unknown as string }));
  if (o.allowCredentials)
    copy.allowCredentials = o.allowCredentials.map((c) => ({ ...c, id: unb64(c.id) as unknown as string }));
  return copy as unknown as PublicKeyCredentialCreationOptions & PublicKeyCredentialRequestOptions;
};

/** Authenticator answers are binary; the server verifies the JSON/base64url shape. */
const deflate = (cred: PublicKeyCredential): Record<string, unknown> => {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = {
    id: cred.id,
    rawId: b64(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: b64(r.clientDataJSON) },
  };
  const resp = out.response as Record<string, unknown>;
  if (r.attestationObject) resp.attestationObject = b64(r.attestationObject);
  if (r.authenticatorData) resp.authenticatorData = b64(r.authenticatorData);
  if (r.signature) resp.signature = b64(r.signature);
  if (r.userHandle) resp.userHandle = b64(r.userHandle);
  return out;
};

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}

const explain = (status: number, body: { error?: string; retryAfterSec?: number } | null): string => {
  const e = body?.error;
  if (status === 429) return `Too many attempts. Try again in about ${body?.retryAfterSec ?? 60} seconds.`;
  switch (e) {
    case 'auth_required':
    case 'session_expired': return 'Sign in first, then set up a passkey.';
    case 'reauth_required': return 'For your security, sign in again to add a passkey.';
    case 'invalid_or_consumed_challenge': return 'That attempt expired. Try again.';
    case 'verification_failed': return 'The passkey check failed. Try again.';
    case 'credential_exists': return 'This passkey is already on your account.';
    case 'unknown_credential': return 'This device has no passkey for this account.';
    case 'unavailable': return 'Passkeys are not available on this deployment.';
    default: return `Unexpected answer (${status}). Try again.`;
  }
};

const readError = async (r: Response): Promise<string> => {
  const body = (await r.json().catch(() => null)) as { error?: string; retryAfterSec?: number } | null;
  return explain(r.status, body);
};

/** navigator.credentials DOMExceptions: NotAllowed = the user cancelled or the
 * prompt timed out; anything else is an authenticator/platform failure. */
const ceremonyError = (e: unknown): string =>
  e instanceof DOMException && e.name === 'NotAllowedError'
    ? 'Cancelled - nothing was saved.'
    : 'This device could not complete the passkey step.';

/** Register a passkey on the signed-in account. */
export async function registerPasskey(signal?: AbortSignal): Promise<PasskeyOutcome> {
  try {
    const optRes = await passkeyRegisterOptionsRequest(signal);
    if (!optRes.ok) return { ok: false, message: await readError(optRes) };
    const opt = (await optRes.json()) as { options?: OptionsJson };
    if (!opt.options) return { ok: false, message: 'The server sent an incomplete answer.' };
    const cred = (await navigator.credentials.create({
      publicKey: inflate(opt.options),
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, message: 'This device did not create a passkey.' };
    const v = await passkeyRegisterVerifyRequest(deflate(cred), signal);
    if (!v.ok) return { ok: false, message: await readError(v) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: ceremonyError(e) };
  }
}

/** Sign in with an existing passkey (discoverable credential). */
export async function loginWithPasskey(signal?: AbortSignal): Promise<PasskeyOutcome> {
  try {
    const optRes = await passkeyLoginOptionsRequest(signal);
    if (!optRes.ok) return { ok: false, message: await readError(optRes) };
    const opt = (await optRes.json()) as { challengeId?: string; options?: OptionsJson };
    if (!opt.challengeId || !opt.options) return { ok: false, message: 'The server sent an incomplete answer.' };
    const asrt = (await navigator.credentials.get({
      publicKey: inflate(opt.options),
    })) as PublicKeyCredential | null;
    if (!asrt) return { ok: false, message: 'No passkey was selected.' };
    const v = await passkeyLoginVerifyRequest(opt.challengeId, deflate(asrt), signal);
    if (!v.ok) return { ok: false, message: await readError(v) };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: ceremonyError(e) };
  }
}
