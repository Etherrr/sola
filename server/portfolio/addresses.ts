/**
 * Addresses & Wallets manager (plan §7 / Phase C.2): ONE address store per user
 * replacing the disconnected Track / Saved Addresses state. Session-gated;
 * routes stay UNWIRED until review.
 *
 * Model:
 * - portfolio_addresses rows are the user's address book. verification='watched'
 *   is paste-only (no ownership proof); verification='verified' is written only
 *   from a completed wallet-link challenge (server/auth/wallet.ts) - the UI must
 *   never let a watched address be marked verified by hand.
 * - EVM addresses are stored checksummed (EIP-55 display form) and matched
 *   case-insensitively; Solana base58 is stored and matched EXACTLY
 *   (case-sensitive alphabet).
 * - Removal is a soft delete (removed_at) so history/snapshots stay
 *   attributable; a re-add of a removed address revives the row.
 */
import { checkEvmAddress, checkSolanaAddress } from './address';
import { readLiveSession, recentlyAuthenticated, type SessionRow } from '../auth/sessions';
import { readSessionCookie, SESSION_COOKIE, type NativeAuthEnv } from '../auth/email';
import { requireSameOrigin } from '../auth/guards';
import type { ChallengeDb } from '../auth/challenges';

export type AddressNetwork = 'ethereum' | 'solana';

export type AddressEntry = {
  network: AddressNetwork;
  address: string; // display form: EIP-55 for EVM, exact base58 for Solana
  label: string;
  verification: 'watched' | 'verified';
  createdAt: string;
  lastObservedAt: string | null;
};

export const MAX_ADDRESSES_PER_NETWORK = 5;
export const MAX_LABEL_LEN = 40;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Canonical storage key: EVM lowercase; Solana exact (case-sensitive). */
export const canonicalOf = (network: AddressNetwork, display: string): string =>
  network === 'ethereum' ? display.toLowerCase() : display;

export function validateAddress(
  network: unknown,
  address: unknown,
): { network: AddressNetwork; display: string } | null {
  if (network !== 'ethereum' && network !== 'solana') return null;
  const check = network === 'ethereum' ? checkEvmAddress(address) : checkSolanaAddress(address);
  return check.ok ? { network, display: check.address } : null;
}

export function validateLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_LABEL_LEN && !CONTROL.test(trimmed)
    ? trimmed
    : null;
}

async function liveUser(req: Request, db: ChallengeDb): Promise<string | null> {
  const id = readSessionCookie(req);
  if (!id) return null;
  const session: SessionRow | null = await readLiveSession(db, id);
  return session?.user_id ?? null;
}

/** Fresh-auth variant for destructive mutations (removal). */
async function freshUser(req: Request, db: ChallengeDb): Promise<string | null> {
  const id = readSessionCookie(req);
  if (!id) return null;
  const session: SessionRow | null = await readLiveSession(db, id);
  return session && recentlyAuthenticated(session) ? session.user_id : null;
}

async function ensurePortfolio(db: ChallengeDb, userId: string, now: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM portfolios WHERE user_id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const r = await db
    .prepare(`INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES (?, ?, NULL, ?)`)
    .bind(id, userId, now)
    .run();
  if (!r.success) throw new Error('portfolio_insert_failed');
  return id;
}

const ADDRESS_COLS = `pa.network, pa.address, pa.label, pa.verification, pa.created_at`;
const rowToEntry = (r: { network: string; address: string; label: string; verification: string; created_at: string }): AddressEntry => ({
  network: r.network as AddressNetwork,
  address: r.address,
  label: r.label,
  verification: r.verification as 'watched' | 'verified',
  createdAt: r.created_at,
  lastObservedAt: null, // wired to the latest snapshot observation when snapshots land
});

/** GET: list the session user's addresses (watched + verified). */
export async function handleAddressesList(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'GET')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'GET' });
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const userId = await liveUser(req, db);
  if (!userId) return json(401, { error: 'auth_required', requestId });
  const rows = await db
    .prepare(
      `SELECT ${ADDRESS_COLS} FROM portfolio_addresses pa
        JOIN portfolios p ON p.id = pa.portfolio_id
       WHERE p.user_id = ? AND pa.removed_at IS NULL
       ORDER BY pa.created_at ASC`,
    )
    .bind(userId)
    .all<{ network: string; address: string; label: string; verification: string; created_at: string }>();
  return json(200, { status: 'ok', addresses: rows.results.map(rowToEntry), requestId });
}

/** POST {network, address, label}: add a WATCHED address. Watching is not
 *  ownership proof; the response echoes verification='watched' explicitly. */
export async function handleAddressAdd(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const userId = await liveUser(req, db);
  if (!userId) return json(401, { error: 'auth_required', requestId });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_request', requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: 'invalid_address', requestId });
  const label = validateLabel(body?.label);
  if (!label) return json(400, { error: 'invalid_label', requestId });

  const now = new Date().toISOString();
  const portfolioId = await ensurePortfolio(db, userId, now);
  const canonical = canonicalOf(addr.network, addr.display);

  const count = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM portfolio_addresses
        WHERE portfolio_id = ? AND network = ? AND removed_at IS NULL`,
    )
    .bind(portfolioId, addr.network)
    .first<{ n: number }>();
  const active = await db
    .prepare(
      `SELECT verification, removed_at FROM portfolio_addresses
        WHERE portfolio_id = ? AND network = ? AND address = ?`,
    )
    .bind(portfolioId, addr.network, canonical)
    .first<{ verification: string; removed_at: string | null }>();
  if (active && !active.removed_at)
    return json(409, { error: 'address_exists', verification: active.verification, requestId });
  if (!active && (count?.n ?? 0) >= MAX_ADDRESSES_PER_NETWORK)
    return json(409, { error: 'too_many_addresses', max: MAX_ADDRESSES_PER_NETWORK, requestId });

  if (active?.removed_at) {
    // revive: keep the original verification class (a removed verified row is
    // NOT silently revived as verified - it must re-link to re-verify)
    await db
      .prepare(
        `UPDATE portfolio_addresses SET label = ?, removed_at = NULL, verification = 'watched'
          WHERE portfolio_id = ? AND network = ? AND address = ?`,
      )
      .bind(label, portfolioId, addr.network, canonical)
      .run();
  } else {
    const r = await db
      .prepare(
        `INSERT INTO portfolio_addresses (portfolio_id, network, address, label, verification, created_at)
         VALUES (?, ?, ?, ?, 'watched', ?)`,
      )
      .bind(portfolioId, addr.network, canonical, label, now)
      .run();
    if (!r.success) throw new Error('address_insert_failed');
  }
  return json(200, {
    status: 'ok',
    address: { network: addr.network, address: addr.display, label, verification: 'watched' },
    requestId,
  });
}

/** POST {network, address, label}: rename. */
export async function handleAddressRename(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const userId = await liveUser(req, db);
  if (!userId) return json(401, { error: 'auth_required', requestId });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_request', requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: 'invalid_address', requestId });
  const label = validateLabel(body?.label);
  if (!label) return json(400, { error: 'invalid_label', requestId });

  const r = await db
    .prepare(
      `UPDATE portfolio_addresses SET label = ?
        WHERE network = ? AND address = ? AND removed_at IS NULL
          AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)`,
    )
    .bind(label, addr.network, canonicalOf(addr.network, addr.display), userId)
    .run();
  if (!r.success || (r.meta?.changes ?? 0) !== 1) return json(404, { error: 'not_found', requestId });
  return json(200, { status: 'ok', requestId });
}

/** POST {network, address}: soft-remove. Destructive - requires a FRESH session
 *  (created within the re-auth window), same bar as wallet linking. */
export async function handleAddressRemove(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const userId = await freshUser(req, db);
  if (!userId) return json(403, { error: 'reauth_required', requestId });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_request', requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: 'invalid_address', requestId });

  const now = new Date().toISOString();
  const r = await db
    .prepare(
      `UPDATE portfolio_addresses SET removed_at = ?
        WHERE network = ? AND address = ? AND removed_at IS NULL
          AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)`,
    )
    .bind(now, addr.network, canonicalOf(addr.network, addr.display), userId)
    .run();
  if (!r.success || (r.meta?.changes ?? 0) !== 1) return json(404, { error: 'not_found', requestId });
  return json(200, { status: 'ok', removed: true, requestId });
}

export { SESSION_COOKIE };
