'use client';
import { useEffect, useState } from 'react';
import { authEmailChallenge, authEmailVerify } from '../portfolio/api-client';
import { loginWithPasskey, passkeysSupported } from './passkey-client';
import { safeNextPath, DEFAULT_NEXT } from './next-path';

/**
 * Functional native sign-in form (preview): email code challenge -> verify ->
 * session cookie, against the live /api/v1/auth/email routes. Honest errors
 * for every documented response; no fake success states. A session alone does
 * not unlock data - entitled accounts only (routes answer 403 otherwise).
 */

type Step =
  | { kind: 'email' }
  | { kind: 'code'; email: string; expiresAt: string; expiresAtText: string | null }
  | { kind: 'done'; email: string | null };

export function SignInForm({ context = 'sign-in' }: { context?: 'sign-in' | 'create-account' }) {
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Passive status line (e.g. after a same-email resend); failures stay in error.
  const [note, setNote] = useState<string | null>(null);
  // Flipped by a timer at the server's expiresAt so a lingering page stops
  // claiming a live code; never computed during render.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (step.kind !== 'code') return;
    const ms = Date.parse(step.expiresAt) - Date.now();
    // Async even when already past: no synchronous setState in the effect body.
    const t = setTimeout(() => setExpired(true), Number.isFinite(ms) ? Math.max(0, ms) : 0);
    return () => clearTimeout(t);
  }, [step]);
  // Resume destination: validated once on mount; never trust the raw query value.
  const [next] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_NEXT
      : safeNextPath(new URLSearchParams(window.location.search).get('next')),
  );

  const explain = (status: number, body: { error?: string; retryAfterSec?: number } | null): string => {
    const e = body?.error;
    if (status === 429 && e === 'too_many_attempts') return 'Too many wrong codes - request a new code.';
    if (status === 429) return `Too many attempts. Try again in about ${body?.retryAfterSec ?? 60} seconds.`;
    switch (e) {
      case 'invalid_email': return 'That does not look like an email address.';
      case 'invalid_request': return 'Enter the email and the code from it.';
      case 'invalid_code': return 'That code is not right, or it expired. Check it and try again.';
      case 'email_send_failed': return 'The code email could not be sent. Try again.';
      case 'disabled': return 'Native sign-in is switched off on this deployment.';
      case 'not_configured': return 'Native sign-in is not configured on this deployment.';
      case 'email_provider_not_configured': return 'Email delivery is not configured yet.';
      default: return `Unexpected answer (${status}). Try again.`;
    }
  };

  const sendCode = async (target?: string) => {
    const em = target ?? email;
    setBusy(true); setError(null);
    try {
      const r = await authEmailChallenge(em);
      const body = (await r.json().catch(() => null)) as { error?: string; retryAfterSec?: number; expiresAt?: string } | null;
      if (r.ok && body?.expiresAt) {
        // Absolute local expiry from the server's actual expiresAt: never goes
        // stale like a relative "in N minutes" would. Malformed -> no time shown.
        const at = new Date(body.expiresAt);
        const atText = Number.isFinite(at.getTime())
          ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(at)
          : null;
        setStep({ kind: 'code', email: em, expiresAt: body.expiresAt, expiresAtText: atText });
        setExpired(false);
        setCode('');
        setNote(target ? 'New code sent.' : null);
      } else setError(explain(r.status, body));
    } catch { setError('Network error. Try again.'); }
    setBusy(false);
  };

  const verify = async () => {
    setBusy(true); setError(null);
    const em = step.kind === 'code' ? step.email : email;
    try {
      const r = await authEmailVerify(em, code);
      const body = (await r.json().catch(() => null)) as { error?: string; retryAfterSec?: number } | null;
      if (r.ok) setStep({ kind: 'done', email: em });
      else setError(explain(r.status, body));
    } catch { setError('Network error. Try again.'); }
    setBusy(false);
  };

  const signInWithPasskey = async () => {
    setBusy(true); setError(null);
    const out = await loginWithPasskey();
    if (out.ok) setStep({ kind: 'done', email: null });
    else setError(out.message);
    setBusy(false);
  };

  if (step.kind === 'done')
    return (
      <div>
        <p>
          <strong>{step.email ? `Signed in as ${step.email}.` : 'Signed in.'}</strong>
        </p>
        <p><a className="button primary" href={next}>Continue</a></p>
      </div>
    );

  return (
    <form
      className="accounts"
      onSubmit={(e) => { e.preventDefault(); if (!busy) void (step.kind === 'email' ? sendCode() : verify()); }}
    >
      {step.kind === 'email' ? (
        <p>
          <label htmlFor="signin-email">Email you were invited with</label>
          <br />
          <input
            id="signin-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </p>
      ) : (
        <p>
          <label htmlFor="signin-code">Email code</label>
          <br />
          <input
            id="signin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <br />
          <small>
            Code sent to {step.email}
            {step.expiresAtText ? ` - it expires at ${step.expiresAtText}` : ''}.{' '}
            {expired ? 'That code has expired - send a new one.' : ''}
          </small>
        </p>
      )}
      {error && <p role="alert" className="form-alert">{error}</p>}
      {note && !error && <p><em>{note}</em></p>}
      <p className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Working…' : step.kind === 'email' ? 'Send sign-in code' : 'Sign in'}
        </button>{' '}
        {step.kind === 'code' && (
          <>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void sendCode(step.kind === 'code' ? step.email : undefined)}
            >
              Send a new code
            </button>{' '}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => { setStep({ kind: 'email' }); setError(null); setNote(null); }}
            >
              Use a different email
            </button>
          </>
        )}
        {step.kind === 'email' && passkeysSupported() && (
          <>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void signInWithPasskey()}
            >
              Sign in with a passkey
            </button>
            {context === 'create-account' && (
              <span className="passkey-note">
                <em>Passkeys work after you have signed in once and set one up.</em>
              </span>
            )}
          </>
        )}
      </p>
    </form>
  );
}
