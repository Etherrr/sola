/**
 * Single-use challenge issuance and atomic claiming for native Sola auth
 * (email codes, WebAuthn ceremonies, SIWE/SIWS nonces).
 *
 * Invariants (docs/V0_2_ARCHITECTURE.md §3, Isa advisory 2026-10-25):
 * - Only the secret HASH is stored; the plaintext code/nonce leaves the server once.
 * - A claim is ONE conditional UPDATE bound to a fresh server attempt id. The caller
 *   may create a session only when that statement affected exactly one row.
 * - consumed_at alone is never proof for THIS request; the row must carry this
 *   request's attempt id (the winning UPDATE writes it atomically).
 * - A crash after a successful claim burns the challenge; there is no un-consume.
 * - Zero affected rows is not a SQL error in D1: meta.changes is the gate.
 *
 * Nonce binding (reviewer 2026-10-25): for every verifier (email code, SIWE/SIWS
 * signed message, WebAuthn clientDataJSON), the value the caller proves
 * possession of IS the challenge secret, and claiming matches
 * secret_hash = SHA-256(nonce). The signed message's embedded nonce and the
 * stored challenge are therefore the same coupling - there is deliberately NO
 * consume-by-subject path (claiming "the latest challenge for this subject"
 * without the exact secret would decouple the cryptographic proof from the
 * consumption and must never be introduced as a simplification).
 */

export type ChallengeKind =
  | 'email_code'
  | 'webauthn_register'
  | 'webauthn_login'
  | 'wallet_evm'
  | 'wallet_solana';

export interface ChallengeDb {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
}

export interface IssuedChallenge {
  id: string;
  /** Plaintext secret returned once (email code, WebAuthn challenge or SIWE/SIWS nonce). */
  secret: string;
  expiresAt: string;
}

const toHex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b instanceof Uint8Array ? b : b)].map((x) => x.toString(16).padStart(2, '0')).join('');

const hash = async (s: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const randomHex = (bytes: number): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

const newId = (): string => randomHex(16);

export async function issueChallenge(
  db: ChallengeDb,
  kind: ChallengeKind,
  subject: string,
  ttlMs: number,
  now: Date = new Date(),
  secretOverride?: string,
): Promise<IssuedChallenge> {
  const id = newId();
  const secret = secretOverride ?? randomHex(kind === 'email_code' ? 4 : 24);
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const r = await db
    .prepare(
      `INSERT INTO challenges (id, kind, subject, secret_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, kind, subject, await hash(secret), expiresAt, now.toISOString())
    .run();
  if (!r.success) throw new Error('challenge_insert_failed');
  // A fresh issue invalidates every older unconsumed challenge for this kind+subject,
  // matching the email-OTP convention "expires after 10 minutes or a new request".
  await db
    .prepare(
      `UPDATE challenges SET consumed_at = ?, claim_attempt_id = ?
       WHERE kind = ? AND subject = ? AND consumed_at IS NULL AND id != ?`,
    )
    .bind(now.toISOString(), 'superseded:' + id, kind, subject, id)
    .run();
  return { id, secret, expiresAt };
}

/**
 * Atomically claim the unconsumed, unexpired challenge of this kind+subject matching
 * the presented secret, binding it to attemptId. Returns true only when THIS call
 * flipped exactly one row. Any later claim of the same challenge returns false.
 */
export async function claimChallenge(
  db: ChallengeDb,
  kind: ChallengeKind,
  subject: string,
  secret: string,
  attemptId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!attemptId) throw new Error('attempt_id_required');
  const r = await db
    .prepare(
      `UPDATE challenges
         SET consumed_at = ?, claim_attempt_id = ?
       WHERE kind = ? AND subject = ? AND secret_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
         AND id = (
           SELECT id FROM challenges
            WHERE kind = ? AND subject = ? AND secret_hash = ?
              AND consumed_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
         )`,
    )
    .bind(
      now.toISOString(), attemptId,
      kind, subject, await hash(secret),
      now.toISOString(),
      kind, subject, await hash(secret),
      now.toISOString(),
    )
    .run();
  return r.success === true && r.meta?.changes === 1;
}

/** Count a failed presentation (throttles brute force) without consuming. */
export async function recordFailedAttempt(db: ChallengeDb, kind: ChallengeKind, subject: string): Promise<void> {
  await db
    .prepare(
      `UPDATE challenges SET attempts = attempts + 1
       WHERE kind = ? AND subject = ? AND consumed_at IS NULL`,
    )
    .bind(kind, subject)
    .run();
}

export async function getChallengeState(
  db: ChallengeDb,
  kind: ChallengeKind,
  subject: string,
): Promise<{ consumed_at: string | null; claim_attempt_id: string | null; attempts: number } | null> {
  return db
    .prepare(
      `SELECT consumed_at, claim_attempt_id, attempts FROM challenges
       WHERE kind = ? AND subject = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(kind, subject)
    .first();
}
