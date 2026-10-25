/**
 * Opaque-id session store for native Sola auth.
 * Cookie carries only the session id; the row carries user + lifecycle.
 * Rotation issues a fresh id linked to the old row (rotated_from) and revokes the old.
 */
import type { ChallengeDb } from './challenges';

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  rotated_from: string | null;
  revoked_at: string | null;
}

const toHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const newId = (): string => toHex(crypto.getRandomValues(new Uint8Array(24)));

export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000; // 14 days
export const SENSITIVE_REAUTH_MS = 10 * 60 * 1000; // 10 minutes

export async function createSession(
  db: ChallengeDb,
  userId: string,
  now: Date = new Date(),
): Promise<SessionRow> {
  const row: SessionRow = {
    id: newId(),
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    rotated_from: null,
    revoked_at: null,
  };
  const r = await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, rotated_from, revoked_at)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(row.id, row.user_id, row.created_at, row.expires_at)
    .run();
  if (!r.success) throw new Error('session_insert_failed');
  return row;
}

/** Returns the live session row, or null when unknown, revoked or expired. */
export async function readLiveSession(
  db: ChallengeDb,
  id: string,
  now: Date = new Date(),
): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, created_at, expires_at, rotated_from, revoked_at
         FROM sessions
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(id, now.toISOString())
    .first<SessionRow>();
}

/** Rotate: revoke the old id and issue a fresh one for the same user. */
export async function rotateSession(
  db: ChallengeDb,
  id: string,
  now: Date = new Date(),
): Promise<SessionRow | null> {
  const old = await readLiveSession(db, id, now);
  if (!old) return null;
  const revoked = await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(now.toISOString(), id)
    .run();
  if (!(revoked.success && revoked.meta?.changes === 1)) return null;
  const fresh = await createSession(db, old.user_id, now);
  await db
    .prepare(`UPDATE sessions SET rotated_from = ? WHERE id = ?`)
    .bind(id, fresh.id)
    .run();
  return { ...fresh, rotated_from: id };
}

export async function revokeSession(db: ChallengeDb, id: string, now: Date = new Date()): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(now.toISOString(), id)
    .run();
}

/** Sign out everywhere: revoke all of a user's sessions. */
export async function revokeAllSessions(db: ChallengeDb, userId: string, now: Date = new Date()): Promise<number> {
  const r = await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(now.toISOString(), userId)
    .run();
  return r.success ? (r.meta?.changes ?? 0) : 0;
}

/** True when the session was created recently enough for account-sensitive changes. */
export function recentlyAuthenticated(session: SessionRow, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(session.created_at) <= SENSITIVE_REAUTH_MS;
}
