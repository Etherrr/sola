// migrations/0001_accounts_and_counters.sql
var accounts_and_counters_default = "-- Applied once, only after the owner approves creating the D1 binding.\n-- Mirrors server/accounts/d1.ts SCHEMA_SQL + COUNTERS_SQL; keep in sync.\nCREATE TABLE IF NOT EXISTS tracked_addresses (\n  owner_issuer_subject TEXT NOT NULL,\n  network TEXT NOT NULL CHECK (network IN ('ethereum', 'solana')),\n  address TEXT NOT NULL,\n  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (owner_issuer_subject, network, address)\n);\nCREATE TABLE IF NOT EXISTS rate_counters (\n  scope TEXT NOT NULL,\n  owner TEXT NOT NULL,\n  window_start INTEGER NOT NULL,\n  window_ms INTEGER NOT NULL,\n  count INTEGER NOT NULL CHECK (count >= 0),\n  PRIMARY KEY (scope, owner, window_start, window_ms)\n);\n";

// migrations/0002_native_auth.sql
var native_auth_default = "-- DRAFT for staging only (v0.2-preview). Never applied to production without the\n-- review-gated migration rehearsal + production backup in docs/V0_2_ARCHITECTURE.md \xA74.\n-- Native Sola identity: users, identities, sessions, single-use challenges, wallet links,\n-- entitlements, portfolios and observation snapshots. Existing 0001 tables untouched.\n\nCREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  status TEXT NOT NULL CHECK (status IN ('active','disabled')),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS auth_identities (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  kind TEXT NOT NULL CHECK (kind IN ('email','passkey','wallet_evm','wallet_solana')),\n  identifier TEXT NOT NULL,\n  verified_at TEXT NOT NULL,\n  metadata TEXT,\n  UNIQUE (kind, identifier)\n);\n\nCREATE TABLE IF NOT EXISTS sessions (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  expires_at TEXT NOT NULL,\n  rotated_from TEXT,\n  revoked_at TEXT,\n  ip_hash TEXT,\n  ua_hash TEXT\n);\nCREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);\n\n-- Single-use challenges. claim_attempt_id is written by the ONE conditional UPDATE that\n-- wins the claim; a session may be created only when this request's claim affected\n-- exactly one row bound to ITS attempt id. A crash after a successful claim burns the\n-- challenge: there is no automatic un-consume.\nCREATE TABLE IF NOT EXISTS challenges (\n  id TEXT PRIMARY KEY,\n  kind TEXT NOT NULL CHECK (kind IN ('email_code','webauthn_register','webauthn_login','wallet_evm','wallet_solana')),\n  subject TEXT NOT NULL,\n  secret_hash TEXT NOT NULL,\n  expires_at TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  consumed_at TEXT,\n  claim_attempt_id TEXT,\n  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)\n);\nCREATE INDEX IF NOT EXISTS challenges_subject ON challenges(kind, subject);\n\nCREATE TABLE IF NOT EXISTS wallet_links (\n  chain TEXT NOT NULL CHECK (chain IN ('ethereum','solana')),\n  address TEXT NOT NULL,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  verified_at TEXT NOT NULL,\n  challenge_id TEXT NOT NULL REFERENCES challenges(id),\n  PRIMARY KEY (chain, address)\n);\n\nCREATE TABLE IF NOT EXISTS entitlements (\n  id TEXT PRIMARY KEY,\n  email TEXT,\n  wallet_chain TEXT,\n  wallet_address TEXT,\n  invite_code TEXT,\n  granted_by TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  revoked_at TEXT\n);\n\nCREATE TABLE IF NOT EXISTS portfolios (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  display_prefs TEXT,\n  created_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS portfolio_addresses (\n  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),\n  network TEXT NOT NULL CHECK (network IN ('ethereum','solana')),\n  address TEXT NOT NULL,\n  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),\n  verification TEXT NOT NULL CHECK (verification IN ('watched','verified')),\n  created_at TEXT NOT NULL,\n  removed_at TEXT,\n  PRIMARY KEY (portfolio_id, network, address)\n);\n\nCREATE TABLE IF NOT EXISTS sync_runs (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id),\n  requested_at TEXT NOT NULL,\n  started_at TEXT,\n  completed_at TEXT,\n  provider TEXT,\n  status TEXT NOT NULL CHECK (status IN ('idle','loading','live','partial','stale','error','unsupported')),\n  error TEXT,\n  completeness TEXT\n);\n\nCREATE TABLE IF NOT EXISTS balance_snapshots (\n  id TEXT PRIMARY KEY,\n  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),\n  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),\n  network TEXT NOT NULL,\n  address TEXT NOT NULL,\n  asset_id TEXT NOT NULL,\n  amount TEXT NOT NULL,\n  observed_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS position_snapshots (\n  id TEXT PRIMARY KEY,\n  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),\n  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),\n  protocol TEXT NOT NULL,\n  network TEXT NOT NULL,\n  address TEXT NOT NULL,\n  position TEXT NOT NULL,\n  observed_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS price_observations (\n  id TEXT PRIMARY KEY,\n  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),\n  asset_id TEXT NOT NULL,\n  usd TEXT NOT NULL,\n  source TEXT NOT NULL,\n  price_observed_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS privacy_consents (\n  user_id TEXT NOT NULL REFERENCES users(id),\n  kind TEXT NOT NULL,\n  version TEXT NOT NULL,\n  consented_at TEXT NOT NULL,\n  revoked_at TEXT,\n  PRIMARY KEY (user_id, kind, version)\n);\n";

// migrations/0003_portfolio_user_unique.sql
var portfolio_user_unique_default = "-- 0003: one portfolio per user, enforced by the database.\n-- ensurePortfolio and the wallet-link writer both used check-then-insert,\n-- which races: two concurrent writers could insert two portfolios for one\n-- user and split the address book/history across them. The UNIQUE index makes\n-- the database the arbiter; writers use INSERT ... ON CONFLICT(user_id)\n-- DO NOTHING followed by SELECT (atomic, race-safe).\n-- NOTE: staging was inspected for pre-existing duplicates BEFORE applying\n-- (SELECT user_id, COUNT(*) FROM portfolios GROUP BY user_id HAVING COUNT(*)>1\n-- returned zero rows); production data must be inspected the same way before\n-- this migration ever runs there - never blind-apply a unique index.\nCREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_unique ON portfolios(user_id);\n";

// server/portfolio/keccak.ts
var MASK = (1n << 64n) - 1n;
var RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
];
var ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];
var rotl = (x, n) => n === 0 ? x : (x << BigInt(n) | x >> BigInt(64 - n)) & MASK;
function permute(s) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    const d = [0, 1, 2, 3, 4].map((x) => c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1));
    for (let i = 0; i < 25; i++) s[i] = s[i] ^ d[i % 5];
    const b = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] = b[x + 5 * y] ^ ~b[(x + 1) % 5 + 5 * y] & MASK & b[(x + 2) % 5 + 5 * y];
    s[0] = s[0] ^ RC[round];
  }
}
function keccak256Hex(input) {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 1;
  padded[padded.length - 1] = padded[padded.length - 1] | 128;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = lane << 8n | BigInt(padded[off + i * 8 + j]);
      s[i] = s[i] ^ lane;
    }
    permute(s);
  }
  let out = "";
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 8; j++)
      out += Number(s[i] >> BigInt(8 * j) & 0xffn).toString(16).padStart(2, "0");
  return out;
}
var keccak256Utf8 = (text) => keccak256Hex(new TextEncoder().encode(text));

// server/portfolio/address.ts
function toChecksumAddress(hex40) {
  const lower = hex40.toLowerCase();
  const hash = keccak256Utf8(lower);
  let out = "0x";
  for (let i = 0; i < 40; i++)
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}
function checkEvmAddress(input) {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input))
    return { ok: false, reason: "format" };
  const body = input.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  const canonical = toChecksumAddress(body);
  if (mixed && canonical !== input) return { ok: false, reason: "checksum" };
  return { ok: true, address: canonical };
}
var BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
function checkSolanaAddress(input) {
  if (typeof input !== "string" || input.length < 32 || input.length > 44 || !BASE58.test(input))
    return { ok: false, reason: "format" };
  return { ok: true, address: input };
}

// server/auth/sessions.ts
var SESSION_TTL_MS = 14 * 24 * 3600 * 1e3;
var SENSITIVE_REAUTH_MS = 10 * 60 * 1e3;
async function readLiveSession(db, id, now2 = /* @__PURE__ */ new Date()) {
  return db.prepare(
    `SELECT id, user_id, created_at, expires_at, rotated_from, revoked_at
         FROM sessions
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`
  ).bind(id, now2.toISOString()).first();
}
function recentlyAuthenticated(session, now2 = /* @__PURE__ */ new Date()) {
  return now2.getTime() - Date.parse(session.created_at) <= SENSITIVE_REAUTH_MS;
}

// server/auth/guards.ts
function requireSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return new Response(JSON.stringify({ error: "origin_required" }), {
    status: 403,
    headers: { "content-type": "application/json" }
  });
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return new Response(JSON.stringify({ error: "origin_invalid" }), {
      status: 403,
      headers: { "content-type": "application/json" }
    });
  }
  if (host !== new URL(req.url).host)
    return new Response(JSON.stringify({ error: "origin_mismatch" }), {
      status: 403,
      headers: { "content-type": "application/json" }
    });
  return null;
}
async function requireLiveSession(req, db) {
  const id = readSessionCookie(req);
  if (!id)
    return new Response(JSON.stringify({ error: "auth_required" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  const session = await readLiveSession(db, id);
  if (!session)
    return new Response(JSON.stringify({ error: "session_expired" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  return { userId: session.user_id, session };
}
async function requireEntitledSession(req, db) {
  const base = await requireLiveSession(req, db);
  if (base instanceof Response) return base;
  const entitled = await db.prepare(
    `SELECT e.id FROM entitlements e
        WHERE e.revoked_at IS NULL AND (
          EXISTS (SELECT 1 FROM auth_identities i
                  WHERE i.user_id = ? AND i.kind = 'email'
                    AND i.verified_at IS NOT NULL
                    AND e.email IS NOT NULL
                    AND LOWER(i.identifier) = LOWER(e.email))
          OR EXISTS (SELECT 1 FROM auth_identities i
                  WHERE i.user_id = ?
                    AND i.verified_at IS NOT NULL
                    AND e.wallet_address IS NOT NULL
                    AND ((i.kind = 'wallet_evm' AND e.wallet_chain = 'ethereum'
                          AND LOWER(i.identifier) = LOWER(e.wallet_address))
                      OR (i.kind = 'wallet_solana' AND e.wallet_chain = 'solana'
                          AND i.identifier = e.wallet_address)))
        ) LIMIT 1`
  ).bind(base.userId, base.userId).first();
  if (!entitled)
    return new Response(JSON.stringify({ error: "not_entitled" }), {
      status: 403,
      headers: { "content-type": "application/json" }
    });
  return base;
}

// server/accounts/d1-limiter.ts
function createD1Limiter(db, windows, scope, now2 = Date.now) {
  async function check(key) {
    const t = now2();
    try {
      let retryAfterSec = 0;
      for (const w2 of windows) {
        const windowStart = Math.floor(t / w2.windowMs) * w2.windowMs;
        const row = await db.prepare(
          `INSERT INTO rate_counters (scope, owner, window_start, window_ms, count)
             VALUES (?1, ?2, ?3, ?4, 1)
             ON CONFLICT (scope, owner, window_start, window_ms) DO UPDATE SET count = count + 1
             RETURNING count`
        ).bind(scope, key, windowStart, w2.windowMs).first();
        const count = row && typeof row.count === "number" ? row.count : w2.limit + 1;
        if (count > w2.limit) {
          retryAfterSec = Math.max(retryAfterSec, Math.ceil((windowStart + w2.windowMs - t) / 1e3));
        }
      }
      if (retryAfterSec > 0) return { allowed: false, retryAfterSec };
      return { allowed: true };
    } catch {
      return { allowed: false, retryAfterSec: 60 };
    }
  }
  async function sweep(keepMs) {
    try {
      await db.prepare("DELETE FROM rate_counters WHERE window_start + window_ms < ?1").bind(now2() - keepMs).run();
    } catch {
    }
  }
  return { check, sweep };
}

// server/auth/email.ts
var CODE_TTL_MS = 10 * 60 * 1e3;
var SESSION_COOKIE = "__Host-sola_session";
var SESSION_MAX_AGE_S = 14 * 24 * 3600;
function readSessionCookie(req) {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

// server/portfolio/addresses.ts
var MAX_ADDRESSES_PER_NETWORK = 5;
var MAX_LABEL_LEN = 40;
var CONTROL = /[\p{Cc}\p{Cf}]/u;
var json = (status, body, headers) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers }
});
var canonicalOf = (network, display) => network === "ethereum" ? display.toLowerCase() : display;
function validateAddress(network, address) {
  if (network !== "ethereum" && network !== "solana") return null;
  const check = network === "ethereum" ? checkEvmAddress(address) : checkSolanaAddress(address);
  return check.ok ? { network, display: check.address } : null;
}
function validateLabel(label) {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_LABEL_LEN && !CONTROL.test(trimmed) ? trimmed : null;
}
async function entitledUser(req, db, fresh) {
  const id = await requireEntitledSession(req, db);
  if (id instanceof Response) return id;
  if (fresh && !recentlyAuthenticated(id.session))
    return json(403, { error: "reauth_required" });
  return id.userId;
}
async function ensurePortfolio(db, userId, now2) {
  const r = await db.prepare(
    `INSERT INTO portfolios (id, user_id, display_prefs, created_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(user_id) DO NOTHING`
  ).bind(crypto.randomUUID(), userId, now2).run();
  if (!r.success) throw new Error("portfolio_insert_failed");
  const row = await db.prepare(`SELECT id FROM portfolios WHERE user_id = ?`).bind(userId).first();
  if (!row) throw new Error("portfolio_lookup_failed");
  return row.id;
}
var ADDRESS_READ_WINDOWS = [{ limit: 60, windowMs: 6e5 }];
var ADDRESS_WRITE_WINDOWS = [{ limit: 30, windowMs: 6e5 }];
async function rateLimit(db, scope, windows, userId, requestId) {
  const lim = await createD1Limiter(db, windows, scope).check(userId);
  return lim.allowed ? null : json(429, { error: "rate_limited", retryAfterSec: lim.retryAfterSec, requestId });
}
var ADDRESS_COLS = `pa.network, pa.address, pa.label, pa.verification, pa.created_at`;
var rowToEntry = (r) => ({
  network: r.network,
  address: r.address,
  label: r.label,
  verification: r.verification,
  createdAt: r.created_at,
  lastObservedAt: null
  // wired to the latest snapshot observation when snapshots land
});
async function handleAddressesList(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "GET")
    return json(405, { error: "method_not_allowed", requestId }, { allow: "GET" });
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const u = await entitledUser(req, db, false);
  if (u instanceof Response) return u;
  const userId = u;
  const rl0 = await rateLimit(db, "portfolio_addresses_read", ADDRESS_READ_WINDOWS, userId, requestId);
  if (rl0) return rl0;
  const rows = await db.prepare(
    `SELECT ${ADDRESS_COLS} FROM portfolio_addresses pa
        JOIN portfolios p ON p.id = pa.portfolio_id
       WHERE p.user_id = ? AND pa.removed_at IS NULL
       ORDER BY pa.created_at ASC`
  ).bind(userId).all();
  return json(200, { status: "ok", addresses: rows.results.map(rowToEntry), requestId });
}
async function handleAddressAdd(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST")
    return json(405, { error: "method_not_allowed", requestId }, { allow: "POST" });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const u = await entitledUser(req, db, false);
  if (u instanceof Response) return u;
  const userId = u;
  const rl = await rateLimit(db, "portfolio_addresses_write", ADDRESS_WRITE_WINDOWS, userId, requestId);
  if (rl) return rl;
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_request", requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: "invalid_address", requestId });
  const label = validateLabel(body?.label);
  if (!label) return json(400, { error: "invalid_label", requestId });
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const portfolioId = await ensurePortfolio(db, userId, now2);
  const canonical = canonicalOf(addr.network, addr.display);
  const active = await db.prepare(
    `SELECT verification, removed_at FROM portfolio_addresses
        WHERE portfolio_id = ? AND network = ? AND address = ?`
  ).bind(portfolioId, addr.network, canonical).first();
  if (active && !active.removed_at)
    return json(409, { error: "address_exists", verification: active.verification, requestId });
  if (active?.removed_at) {
    await db.prepare(
      `UPDATE portfolio_addresses SET label = ?, removed_at = NULL, verification = 'watched'
          WHERE portfolio_id = ? AND network = ? AND address = ?`
    ).bind(label, portfolioId, addr.network, canonical).run();
  } else {
    const r = await db.prepare(
      `INSERT INTO portfolio_addresses (portfolio_id, network, address, label, verification, created_at)
         SELECT ?, ?, ?, ?, 'watched', ?
         WHERE (SELECT COUNT(*) FROM portfolio_addresses
                 WHERE portfolio_id = ? AND network = ? AND removed_at IS NULL) < ?
         ON CONFLICT(portfolio_id, network, address) DO NOTHING`
    ).bind(portfolioId, addr.network, canonical, label, now2, portfolioId, addr.network, MAX_ADDRESSES_PER_NETWORK).run();
    if (!r.success) throw new Error("address_insert_failed");
    if ((r.meta?.changes ?? 0) === 0)
      return json(409, { error: "too_many_addresses", max: MAX_ADDRESSES_PER_NETWORK, requestId });
  }
  return json(200, {
    status: "ok",
    address: { network: addr.network, address: addr.display, label, verification: "watched" },
    requestId
  });
}
async function handleAddressRename(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST")
    return json(405, { error: "method_not_allowed", requestId }, { allow: "POST" });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const u = await entitledUser(req, db, false);
  if (u instanceof Response) return u;
  const userId = u;
  const rl = await rateLimit(db, "portfolio_addresses_write", ADDRESS_WRITE_WINDOWS, userId, requestId);
  if (rl) return rl;
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_request", requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: "invalid_address", requestId });
  const label = validateLabel(body?.label);
  if (!label) return json(400, { error: "invalid_label", requestId });
  const r = await db.prepare(
    `UPDATE portfolio_addresses SET label = ?
        WHERE network = ? AND address = ? AND removed_at IS NULL
          AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)`
  ).bind(label, addr.network, canonicalOf(addr.network, addr.display), userId).run();
  if (!r.success || (r.meta?.changes ?? 0) !== 1) return json(404, { error: "not_found", requestId });
  return json(200, { status: "ok", requestId });
}
async function handleAddressRemove(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST")
    return json(405, { error: "method_not_allowed", requestId }, { allow: "POST" });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const u = await entitledUser(req, db, true);
  if (u instanceof Response) return u;
  const userId = u;
  const rl = await rateLimit(db, "portfolio_addresses_write", ADDRESS_WRITE_WINDOWS, userId, requestId);
  if (rl) return rl;
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_request", requestId });
  }
  const addr = validateAddress(body?.network, body?.address);
  if (!addr) return json(400, { error: "invalid_address", requestId });
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const r = await db.prepare(
    `UPDATE portfolio_addresses SET removed_at = ?
        WHERE network = ? AND address = ? AND removed_at IS NULL
          AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)`
  ).bind(now2, addr.network, canonicalOf(addr.network, addr.display), userId).run();
  if (!r.success || (r.meta?.changes ?? 0) !== 1) return json(404, { error: "not_found", requestId });
  return json(200, { status: "ok", removed: true, requestId });
}

// server/portfolio/units.ts
function formatUnits(raw, decimals) {
  if (decimals < 0 || decimals > 77) throw new RangeError("decimals out of range");
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
function valueUsd(raw, decimals, price) {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(price);
  if (!m) throw new RangeError("bad price");
  const fracLen = (m[2] ?? "").length;
  const priceInt = BigInt(m[1] + (m[2] ?? ""));
  const scaled = raw * priceInt * 1000000n / 10n ** BigInt(decimals + fracLen);
  return formatUnits(scaled, 6);
}

// server/portfolio/domain.ts
var PRICE_MAX_SKEW_MS = 15 * 60 * 1e3;
var DEC_RE = /^-?\d+(\.\d+)?$/;
function splitDec(s) {
  if (!DEC_RE.test(s)) throw new RangeError(`bad decimal: ${s}`);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [whole, frac = ""] = body.split(".");
  return { neg, digits: whole + frac, fracLen: frac.length };
}
function renderScaled(v, fracLen) {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(fracLen + 1, "0");
  const whole = s.slice(0, s.length - fracLen);
  const frac = fracLen > 0 ? s.slice(s.length - fracLen).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
var isZero = (s) => DEC_RE.test(s) && BigInt(s.replace("-", "").replace(".", "") || "0") === 0n;
function divDecimal(a, b) {
  const x = splitDec(a);
  const y = splitDec(b);
  if (x.neg || y.neg) throw new RangeError("divDecimal is unsigned");
  const scaled = BigInt(x.digits) * 10n ** BigInt(8 + y.fracLen) / (BigInt(y.digits) * 10n ** BigInt(x.fracLen));
  return renderScaled(scaled, 8);
}
var addressKey = (network, address) => network === "ethereum" ? address.toLowerCase() : address;
function fromWalletResult(network, w2, balanceObservedAt) {
  const out = [];
  for (const a of w2.assets) {
    const price = a.price !== null && a.priceSource !== null && a.priceObservedAt !== null ? { usd: a.price, source: a.priceSource, observedAt: a.priceObservedAt } : null;
    out.push({
      kind: "wallet_balance",
      asset: { assetId: a.assetId, symbol: a.symbol, decimals: a.decimals },
      network,
      address: w2.address,
      amount: a.amount,
      price,
      valueUsd: a.value,
      source: a.priceSource ?? "provider",
      observedAt: balanceObservedAt,
      protocol: null
    });
  }
  if (w2.aave?.status === "ok") {
    for (const p of w2.aave.positions) {
      const base = {
        asset: { assetId: `eip155:1/erc20:${p.underlyingAsset}`, symbol: p.symbol, decimals: p.decimals },
        network: "ethereum",
        address: w2.address,
        source: p.priceSource ?? "aave-v3",
        observedAt: p.observedAt,
        protocol: "aave-v3"
      };
      const derive = (amount, value) => {
        if (p.priceSource === null || p.priceObservedAt === null || value === null || isZero(amount)) return null;
        try {
          return {
            usd: divDecimal(value, amount),
            source: p.priceSource,
            observedAt: p.priceObservedAt
          };
        } catch {
          return null;
        }
      };
      if (!isZero(p.supplied))
        out.push({ ...base, kind: "protocol_supplied", amount: p.supplied, price: derive(p.supplied, p.suppliedValueUsd), valueUsd: p.suppliedValueUsd });
      if (!isZero(p.variableDebt))
        out.push({ ...base, kind: "protocol_debt", amount: p.variableDebt, price: derive(p.variableDebt, p.variableDebtValueUsd), valueUsd: p.variableDebtValueUsd });
    }
  }
  return out;
}

// server/portfolio/snapshots.ts
var SNAPSHOT_CONSENT_KIND = "portfolio_snapshots";
var ACTIVE_CONSENT = `SELECT 1 FROM privacy_consents
   WHERE user_id = ? AND kind = '${SNAPSHOT_CONSENT_KIND}' AND revoked_at IS NULL`;
var toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
var sha256 = async (s) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function hasSnapshotConsent(db, userId) {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM privacy_consents
        WHERE user_id = ? AND kind = ? AND revoked_at IS NULL LIMIT 1`
  ).bind(userId, SNAPSHOT_CONSENT_KIND).first();
  return row !== null;
}
async function grantSnapshotConsent(db, userId, version = "v1") {
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const r = await db.prepare(
    `INSERT INTO privacy_consents (user_id, kind, version, consented_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, kind, version)
       DO UPDATE SET revoked_at = NULL, consented_at = excluded.consented_at`
  ).bind(userId, SNAPSHOT_CONSENT_KIND, version, now2).run();
  if (!r.success) throw new Error("consent_grant_failed");
}
async function withdrawSnapshotConsent(db, userId) {
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare(
    `UPDATE privacy_consents SET revoked_at = ?
        WHERE user_id = ? AND kind = ? AND revoked_at IS NULL`
  ).bind(now2, userId, SNAPSHOT_CONSENT_KIND).run();
  return deleteSnapshots(db, userId);
}
async function deleteSnapshots(db, userId) {
  const portfolios = await db.prepare(`SELECT id FROM portfolios WHERE user_id = ?`).bind(userId).all();
  let b = 0, p = 0, pr = 0;
  for (const { id } of portfolios.results) {
    b += (await db.prepare(`DELETE FROM balance_snapshots WHERE portfolio_id = ?`).bind(id).run()).meta?.changes ?? 0;
    p += (await db.prepare(`DELETE FROM position_snapshots WHERE portfolio_id = ?`).bind(id).run()).meta?.changes ?? 0;
  }
  pr += (await db.prepare(`DELETE FROM price_observations WHERE sync_run_id IN (SELECT id FROM sync_runs WHERE user_id = ?)`).bind(userId).run()).meta?.changes ?? 0;
  return { balances: b, positions: p, prices: pr };
}
async function recordObservation(db, userId, result, networkOf) {
  const portfolio = await db.prepare(`SELECT id FROM portfolios WHERE user_id = ?`).bind(userId).first();
  if (!portfolio) return { recorded: false, reason: "no_portfolio" };
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const anyPartial = result.wallets.some((w2) => w2.partial || w2.aave && w2.aave.status !== "ok");
  const syncRunId = crypto.randomUUID();
  const r = await db.prepare(
    `INSERT INTO sync_runs (id, user_id, requested_at, started_at, completed_at, provider, status, error, completeness)
       SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?
       WHERE EXISTS (${ACTIVE_CONSENT})`
  ).bind(syncRunId, userId, now2, now2, now2, result.provider, anyPartial ? "partial" : "live", anyPartial ? "partial" : "complete", userId).run();
  if (!r.success) throw new Error("sync_run_insert_failed");
  if ((r.meta?.changes ?? 0) === 0) return { recorded: false, reason: "no_consent" };
  let balances = 0;
  let positions = 0;
  let prices = 0;
  let skipped = 0;
  const seenPrices = /* @__PURE__ */ new Set();
  for (const w2 of result.wallets) {
    const network = networkOf(w2.address);
    for (const p of fromWalletResult(network, w2, result.observedAt)) {
      if (isZero(p.amount)) continue;
      const id = await sha256(
        [portfolio.id, p.kind, p.protocol ?? "", p.asset.assetId, addressKey(p.network, p.address), p.amount, p.observedAt].join("|")
      );
      if (p.kind === "wallet_balance") {
        const ins = await db.prepare(
          `INSERT INTO balance_snapshots (id, sync_run_id, portfolio_id, network, address, asset_id, amount, observed_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${ACTIVE_CONSENT})
             ON CONFLICT(id) DO NOTHING`
        ).bind(id, syncRunId, portfolio.id, p.network, p.address, p.asset.assetId, p.amount, p.observedAt, userId).run();
        if ((ins.meta?.changes ?? 0) === 1) balances += 1;
        else skipped += 1;
      } else {
        const ins = await db.prepare(
          `INSERT INTO position_snapshots (id, sync_run_id, portfolio_id, protocol, network, address, position, observed_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${ACTIVE_CONSENT})
             ON CONFLICT(id) DO NOTHING`
        ).bind(
          id,
          syncRunId,
          portfolio.id,
          p.protocol,
          p.network,
          p.address,
          JSON.stringify({ kind: p.kind, asset: p.asset, amount: p.amount, valueUsd: p.valueUsd }),
          p.observedAt,
          userId
        ).run();
        if ((ins.meta?.changes ?? 0) === 1) positions += 1;
        else skipped += 1;
      }
      if (p.price) {
        const pk = [p.asset.assetId, p.price.usd, p.price.observedAt].join("|");
        if (!seenPrices.has(pk)) {
          seenPrices.add(pk);
          const priceId = await sha256(["price", ...pk].join("|"));
          const ins = await db.prepare(
            `INSERT INTO price_observations (id, sync_run_id, asset_id, usd, source, price_observed_at)
               SELECT ?, ?, ?, ?, ?, ?
               WHERE EXISTS (${ACTIVE_CONSENT})
               ON CONFLICT(id) DO NOTHING`
          ).bind(priceId, syncRunId, p.asset.assetId, p.price.usd, p.price.source, p.price.observedAt, userId).run();
          if ((ins.meta?.changes ?? 0) === 1) prices += 1;
        }
      }
    }
  }
  if (!await hasSnapshotConsent(db, userId)) return { recorded: false, reason: "no_consent" };
  return { recorded: true, syncRunId, balances, positions, prices, skippedDuplicates: skipped };
}

// server/portfolio/consent.ts
var json2 = (status, body, headers) => new Response(JSON.stringify(body), {
  status,
  // Consent state is session-private; never cached (reviewer, 0f49162 note a).
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }
});
var CONSENT_WINDOWS = [{ limit: 20, windowMs: 6e5 }];
async function handleSnapshotConsentStatus(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "GET")
    return json2(405, { error: "method_not_allowed", requestId }, { allow: "GET" });
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json2(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const consented = await hasSnapshotConsent(db, identity.userId);
  return json2(200, { status: "ok", consented, requestId });
}
async function handleSnapshotConsentChange(req, env) {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST")
    return json2(405, { error: "method_not_allowed", requestId }, { allow: "POST" });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json2(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const userId = identity.userId;
  const lim = await createD1Limiter(db, CONSENT_WINDOWS, "portfolio_snapshot_consent").check(userId);
  if (!lim.allowed)
    return json2(429, { error: "rate_limited", retryAfterSec: lim.retryAfterSec, requestId });
  const body = await req.json().catch(() => null);
  if (body?.action === "grant") {
    await grantSnapshotConsent(db, userId);
    return json2(200, { status: "ok", consented: true, requestId });
  }
  if (body?.action === "withdraw") {
    const deleted = await withdrawSnapshotConsent(db, userId);
    return json2(200, { status: "ok", consented: false, deleted, requestId });
  }
  return json2(400, { error: "invalid_request", requestId });
}

// server/portfolio/abi.ts
var SEL_AGGREGATE3 = "0x82ad56cb";
var SEL_GET_ETH_BALANCE = "0x4d2301cc";
var SEL_GET_BLOCK_NUMBER = "0x42cbb15c";
var SEL_GET_CURRENT_BLOCK_TIMESTAMP = "0x0f28c97d";
var SEL_BALANCE_OF = "0x70a08231";
var SEL_DECIMALS = "0x313ce567";
var SEL_LATEST_ROUND_DATA = "0xfeaf968c";
var w = (n) => BigInt(n).toString(16).padStart(64, "0");
var ADDR = /^0x[0-9a-fA-F]{40}$/;
function addressWord(a) {
  if (!ADDR.test(a)) throw new Error("bad address");
  return a.slice(2).toLowerCase().padStart(64, "0");
}
function encodeAggregate3(calls) {
  const elems = calls.map((c) => {
    if (!ADDR.test(c.target) || !/^0x([0-9a-fA-F]{2})*$/.test(c.data)) throw new Error("bad call");
    const bytes = c.data.slice(2);
    const len = bytes.length / 2;
    const padded = bytes.padEnd(Math.ceil(len / 32) * 64, "0");
    return w(BigInt(c.target)) + w(c.allowFailure ? 1 : 0) + w(96) + w(len) + padded;
  });
  let off = calls.length * 32;
  const offsets = [];
  for (const e of elems) {
    offsets.push(w(off));
    off += e.length / 2;
  }
  return SEL_AGGREGATE3 + w(32) + w(calls.length) + offsets.join("") + elems.join("");
}
function decodeAggregate3(hex, expected) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const body = hex.slice(2);
  const size = body.length / 2;
  const read = (byteOff) => byteOff < 0 || byteOff + 32 > size ? null : BigInt("0x" + body.slice(byteOff * 2, (byteOff + 32) * 2));
  const arrOff = read(0);
  if (arrOff === null || arrOff !== 0x20n) return null;
  const n = read(32);
  if (n === null || n !== BigInt(expected)) return null;
  const base = 64;
  let cursor = base + expected * 32;
  const out = [];
  for (let i = 0; i < expected; i++) {
    const rel = read(base + i * 32);
    if (rel === null || rel > BigInt(size)) return null;
    const el = base + Number(rel);
    if (el !== cursor) return null;
    const ok = read(el);
    const bOff = read(el + 32);
    if (ok === null || bOff === null || ok !== 0n && ok !== 1n || bOff !== 0x40n) return null;
    const bStart = el + 64;
    const len = read(bStart);
    if (len === null || len > BigInt(size)) return null;
    const l = Number(len);
    const padded = Math.ceil(l / 32) * 32;
    if (bStart + 32 + padded > size) return null;
    if (/[^0]/.test(body.slice((bStart + 32 + l) * 2, (bStart + 32 + padded) * 2))) return null;
    out.push({
      success: ok === 1n,
      data: "0x" + body.slice((bStart + 32) * 2, (bStart + 32 + l) * 2)
    });
    cursor = bStart + 32 + padded;
  }
  if (cursor !== size) return null;
  return out;
}

// server/portfolio/aave-v3.ts
var SEL_GET_RESERVES_DATA = "0xec489c21";
var SEL_GET_USER_RESERVES_DATA = "0x51974cc0";
var RAY = 10n ** 27n;
function encodeGetReservesData(provider) {
  return SEL_GET_RESERVES_DATA + addressWord(provider);
}
function encodeGetUserReservesData(provider, user) {
  return SEL_GET_USER_RESERVES_DATA + addressWord(provider) + addressWord(user);
}
var HEAD_WORDS = 40;
var Reader = class {
  body;
  size;
  constructor(hex) {
    this.body = hex.slice(2);
    this.size = this.body.length / 2;
  }
  word(byteOff) {
    if (!Number.isInteger(byteOff) || byteOff < 0 || byteOff + 32 > this.size) return null;
    return BigInt("0x" + this.body.slice(byteOff * 2, (byteOff + 32) * 2));
  }
  /** int256 two's-complement decode for signed fields. */
  signedWord(byteOff) {
    const v = this.word(byteOff);
    if (v === null) return null;
    return v >= 1n << 255n ? v - (1n << 256n) : v;
  }
  addr(byteOff) {
    const v = this.word(byteOff);
    if (v === null || v >= 1n << 160n) return null;
    return "0x" + v.toString(16).padStart(40, "0");
  }
  /** Canonical ABI string tail: length word plus padded data, fully inside [limit). */
  str(byteOff, limit) {
    const n = this.word(byteOff);
    if (n === null || n > 256n) return null;
    const len = Number(n);
    const dataStart = byteOff + 32;
    const padded = Math.ceil(len / 32) * 32 || 0;
    const end = dataStart + (len === 0 ? 0 : padded);
    if (dataStart + len > this.size || end > limit) return null;
    const raw = this.body.slice(dataStart * 2, (dataStart + len) * 2);
    if (!/^[\x20-\x7e]*$/.test(Buffer.from(raw, "hex").toString("utf8"))) return null;
    return { value: Buffer.from(raw, "hex").toString("utf8"), end };
  }
};
function decodeGetReservesData(hex) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const r = new Reader(hex);
  const arrOff = r.word(0);
  if (arrOff === null || arrOff !== 0xa0n) return null;
  const unit = r.word(32);
  const refPrice = r.signedWord(64);
  const netPrice = r.signedWord(96);
  const netDecimals = r.word(128);
  const PRICE_BOUND = 10n ** 8n * 10n ** 15n;
  if (unit === null || unit <= 0n || unit > 10n ** 36n || refPrice === null || refPrice <= 0n || refPrice > PRICE_BOUND || netPrice === null || netPrice <= 0n || netPrice > PRICE_BOUND || netDecimals === null || netDecimals > 77n) return null;
  const base = {
    marketReferenceCurrencyUnit: unit,
    marketReferenceCurrencyPriceInUsd: refPrice,
    networkBaseTokenPriceInUsd: netPrice,
    networkBaseTokenPriceDecimals: Number(netDecimals)
  };
  const n = r.word(Number(arrOff));
  if (n === null || n > 512n) return null;
  const count = Number(n);
  const tableStart = Number(arrOff) + 32;
  const elemOffsets = [];
  for (let i = 0; i < count; i++) {
    const o = r.word(tableStart + i * 32);
    if (o === null || o % 32n !== 0n) return null;
    elemOffsets.push(tableStart + Number(o));
  }
  for (let i = 0; i < count; i++) {
    if (elemOffsets[i] < tableStart + count * 32) return null;
    if (i > 0 && elemOffsets[i] <= elemOffsets[i - 1]) return null;
    if (elemOffsets[i] + HEAD_WORDS * 32 > r.size) return null;
  }
  const reserves = [];
  for (let i = 0; i < count; i++) {
    const start = elemOffsets[i];
    const limit = i + 1 < count ? elemOffsets[i + 1] : r.size;
    const head = (k) => r.word(start + k * 32);
    const addrAt = (k) => r.addr(start + k * 32);
    const underlyingAsset = addrAt(0);
    const nameOff = head(1);
    const symbolOff = head(2);
    if (underlyingAsset === null || nameOff === null || symbolOff === null) return null;
    if (nameOff !== BigInt(HEAD_WORDS * 32)) return null;
    const name = r.str(start + Number(nameOff), limit);
    if (name === null) return null;
    if (symbolOff !== BigInt(name.end - start)) return null;
    const symbol = r.str(start + Number(symbolOff), limit);
    if (symbol === null) return null;
    const decimals = head(3);
    const liquidityIndex = head(12);
    const variableBorrowIndex = head(13);
    const lastUpdateTimestamp = head(16);
    const aTokenAddress = addrAt(17);
    const variableDebtTokenAddress = addrAt(18);
    const priceInMarketReferenceCurrency = head(22);
    if (decimals === null || decimals > 77n || liquidityIndex === null || variableBorrowIndex === null || lastUpdateTimestamp === null || aTokenAddress === null || variableDebtTokenAddress === null || priceInMarketReferenceCurrency === null) return null;
    reserves.push({
      underlyingAsset,
      symbol: symbol.value,
      decimals: Number(decimals),
      isActive: head(10) === 1n,
      isFrozen: head(11) === 1n,
      isPaused: head(28) === 1n,
      liquidityIndex,
      variableBorrowIndex,
      lastUpdateTimestamp,
      aTokenAddress,
      variableDebtTokenAddress,
      priceInMarketReferenceCurrency
    });
  }
  return { reserves, base };
}
function decodeGetUserReservesData(hex) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const r = new Reader(hex);
  const arrOff = r.word(0);
  if (arrOff === null || arrOff !== 0x40n) return null;
  const em = r.word(32);
  if (em === null || em > 255n) return null;
  const n = r.word(Number(arrOff));
  if (n === null || n > 512n) return null;
  const count = Number(n);
  const elemsStart = Number(arrOff) + 32;
  if (elemsStart + count * 4 * 32 > r.size) return null;
  const userReserves = [];
  for (let i = 0; i < count; i++) {
    const start = elemsStart + i * 4 * 32;
    const underlyingAsset = r.addr(start);
    const scaledATokenBalance = r.word(start + 32);
    const collat = r.word(start + 64);
    const scaledVariableDebt = r.word(start + 96);
    if (underlyingAsset === null || scaledATokenBalance === null || scaledVariableDebt === null)
      return null;
    if (collat !== 0n && collat !== 1n) return null;
    userReserves.push({
      underlyingAsset,
      scaledATokenBalance,
      usageAsCollateralEnabled: collat === 1n,
      scaledVariableDebt
    });
  }
  return { userReserves, eMode: Number(em) };
}
function rayMul(a, b) {
  if (a < 0n || b < 0n) throw new RangeError("rayMul is unsigned");
  if (a === 0n || b === 0n) return 0n;
  return (a * b + RAY / 2n) / RAY;
}
function currentSupplied(scaledATokenBalance, liquidityIndex) {
  return rayMul(scaledATokenBalance, liquidityIndex);
}
function currentVariableDebt(scaledVariableDebt, variableBorrowIndex) {
  return rayMul(scaledVariableDebt, variableBorrowIndex);
}

// server/portfolio/aave-v3-read.ts
async function readAaveV3PositionsForUsers(rpcCall, addresses) {
  const out = /* @__PURE__ */ new Map();
  if (addresses.users.length === 0) return out;
  const unavailable = (reason) => {
    for (const u of addresses.users) out.set(u, { kind: "unavailable", reason });
    return out;
  };
  const reservesRes = await rpcCall(
    addresses.uiPoolDataProvider,
    encodeGetReservesData(addresses.poolAddressesProvider)
  );
  if (!reservesRes.ok) return unavailable(reservesRes.reason);
  const reservesDecoded = decodeGetReservesData(reservesRes.result);
  if (reservesDecoded === null) return unavailable("bad_payload");
  const byAsset = new Map(
    reservesDecoded.reserves.map((r) => [r.underlyingAsset, r])
  );
  await Promise.all(
    addresses.users.map(async (user) => {
      const userRes = await rpcCall(
        addresses.uiPoolDataProvider,
        encodeGetUserReservesData(addresses.poolAddressesProvider, user)
      );
      if (!userRes.ok) {
        out.set(user, { kind: "unavailable", reason: userRes.reason });
        return;
      }
      const userDecoded = decodeGetUserReservesData(userRes.result);
      if (userDecoded === null) {
        out.set(user, { kind: "unavailable", reason: "bad_payload" });
        return;
      }
      const positions = [];
      for (const u of userDecoded.userReserves) {
        if (u.scaledATokenBalance === 0n && u.scaledVariableDebt === 0n) continue;
        const r = byAsset.get(u.underlyingAsset);
        if (r === void 0) {
          out.set(user, { kind: "unavailable", reason: "bad_payload" });
          return;
        }
        positions.push({
          underlyingAsset: u.underlyingAsset,
          symbol: r.symbol,
          decimals: r.decimals,
          suppliedRaw: currentSupplied(u.scaledATokenBalance, r.liquidityIndex),
          variableDebtRaw: currentVariableDebt(u.scaledVariableDebt, r.variableBorrowIndex),
          usageAsCollateralEnabled: u.usageAsCollateralEnabled,
          reserveFlags: { isActive: r.isActive, isFrozen: r.isFrozen, isPaused: r.isPaused },
          aTokenAddress: r.aTokenAddress,
          variableDebtTokenAddress: r.variableDebtTokenAddress,
          observedAt: r.lastUpdateTimestamp,
          valueUsd: null
        });
      }
      out.set(user, { kind: "ok", positions });
    })
  );
  return out;
}

// server/portfolio/live-provider.ts
var RPC_URL = "https://ethereum-rpc.publicnode.com";
var MAX_RESPONSE_BYTES = 64 * 1024;
var FEED_DECIMALS = 8;
var MAX_FUTURE_S = 30;
var MAX_CLOCK_SKEW_S = 120;
var MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
var AAVE_UI_POOL_DATA_PROVIDER = "0x2dAd8162A989cd99D673dE4425Bb2298Db1E1aA2";
var AAVE_POOL_ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
var AAVE_MAX_RESPONSE_BYTES = 256 * 1024;
var AAVE_DEADLINE_MS = 5e3;
var HEARTBEAT_GRACE_S = 15 * 60;
var feed = (address, heartbeatS) => ({
  address,
  heartbeatS,
  maxAgeS: heartbeatS + HEARTBEAT_GRACE_S
});
var FEEDS = {
  "ETH/USD": feed("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", 3600),
  "USDC/USD": feed("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", 82800),
  "USDT/USD": feed("0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", 86400),
  "DAI/USD": feed("0xAed0c38402a5d19df6E4c03F4E2DcEd6e29c1ee9", 3600)
};
var TOKENS = [
  {
    symbol: "USDC",
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6,
    feed: "USDC/USD"
  },
  {
    symbol: "USDT",
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    decimals: 6,
    feed: "USDT/USD"
  },
  {
    symbol: "DAI",
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    decimals: 18,
    feed: "DAI/USD"
  },
  // Wrapped ether is priced with the ETH/USD feed (a 1:1 wrapper; a depeg would not show).
  {
    symbol: "WETH",
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    decimals: 18,
    feed: "ETH/USD"
  }
];
var HEX = /^0x[0-9a-fA-F]+$/;
var isSafeRpcCode = (c) => typeof c === "number" && Number.isSafeInteger(c) && Math.abs(c) <= 1e6;
var word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
async function readCapped(res, limit) {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let n = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}
function createLiveProvider(over = {}) {
  const d = {
    fetch: (...a) => fetch(...a),
    now: () => /* @__PURE__ */ new Date(),
    rpcUrl: RPC_URL,
    ...over
  };
  return {
    name: "publicnode-rpc+chainlink",
    simulated: false,
    async fetchWallets(addresses, signal, opts) {
      let diag = { step: "build" };
      const fail = (kind) => ({ ok: false, provider: "publicnode-rpc+chainlink", kind, diag });
      const calls = [];
      const self = (data) => {
        calls.push({ target: MULTICALL3, allowFailure: false, data });
        return calls.length - 1;
      };
      const add = (target, data) => {
        calls.push({ target, allowFailure: true, data });
        return calls.length - 1;
      };
      const iBlock = self(SEL_GET_BLOCK_NUMBER);
      const iTime = self(SEL_GET_CURRENT_BLOCK_TIMESTAMP);
      const plan = [];
      addresses.forEach((a, ai) => {
        plan.push({
          addr: ai,
          token: null,
          idx: add(MULTICALL3, SEL_GET_ETH_BALANCE + addressWord(a))
        });
        TOKENS.forEach((t, ti) => {
          plan.push({ addr: ai, token: ti, idx: add(t.address, SEL_BALANCE_OF + addressWord(a)) });
        });
      });
      const feedIds = Object.keys(FEEDS);
      const feedAt = /* @__PURE__ */ new Map();
      for (const f of feedIds)
        feedAt.set(f, {
          dec: add(FEEDS[f].address, SEL_DECIMALS),
          round: add(FEEDS[f].address, SEL_LATEST_ROUND_DATA)
        });
      diag = { step: "request", calls: calls.length };
      let res;
      try {
        res = await d.fetch(d.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: MULTICALL3, data: encodeAggregate3(calls) }, "latest"]
          }),
          signal,
          redirect: "manual"
        });
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      diag = { step: "response", calls: calls.length, http: res.status };
      if (res.status === 429) return fail("rate_limited");
      if (!res.ok) return fail("unavailable");
      let text;
      try {
        text = await readCapped(res, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      if (text === null) return fail("bad_response");
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail("bad_response");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return fail("bad_response");
      if (parsed.jsonrpc !== "2.0" || parsed.id !== 1) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      if (parsed.error === void 0 === (parsed.result === void 0)) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      if (parsed.error !== void 0) {
        const code = parsed.error?.code;
        diag = {
          ...diag,
          step: "rpc_error",
          ...isSafeRpcCode(code) ? { rpcCode: code } : {}
        };
        return fail(code === -32005 || code === -32029 ? "rate_limited" : "unavailable");
      }
      if (typeof parsed.result !== "string") return fail("bad_response");
      const results = decodeAggregate3(parsed.result, calls.length);
      if (!results) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      const out = /* @__PURE__ */ new Map();
      results.forEach((r, i) => out.set(i, r.success && HEX.test(r.data) ? r.data : null));
      const bnHex = out.get(iBlock);
      const tsHex = out.get(iTime);
      if (!bnHex || bnHex.length !== 66 || !tsHex || tsHex.length !== 66) {
        diag = { ...diag, step: "block_info" };
        return fail("bad_response");
      }
      const bnBig = BigInt(bnHex);
      const chainS = BigInt(tsHex);
      if (bnBig === 0n || bnBig > BigInt(Number.MAX_SAFE_INTEGER) || chainS > BigInt(Number.MAX_SAFE_INTEGER)) {
        diag = { ...diag, step: "block_info" };
        return fail("bad_response");
      }
      const blockNumber = bnBig.toString();
      const localS = Math.floor(d.now().getTime() / 1e3);
      if (Math.abs(localS - Number(chainS)) > MAX_CLOCK_SKEW_S) {
        diag = { ...diag, step: "stale_node" };
        return fail("bad_response");
      }
      const nowS = Number(chainS);
      const prices = /* @__PURE__ */ new Map();
      for (const f of feedIds) {
        const at = feedAt.get(f);
        const dec = out.get(at.dec);
        const round = out.get(at.round);
        if (!dec || dec.length !== 66 || !round || round.length !== 2 + 5 * 64) continue;
        if (BigInt(dec) !== BigInt(FEED_DECIMALS)) continue;
        const roundId = BigInt("0x" + word(round, 0));
        const answer = BigInt("0x" + word(round, 1));
        const started = BigInt("0x" + word(round, 2));
        const updatedBig = BigInt("0x" + word(round, 3));
        if (roundId === 0n || started === 0n || updatedBig === 0n || started > updatedBig) continue;
        if (answer <= 0n || answer >= 1n << 255n) continue;
        if (updatedBig > BigInt(Number.MAX_SAFE_INTEGER)) continue;
        const updated = Number(updatedBig);
        if (nowS - updated > FEEDS[f].maxAgeS || updated - nowS > MAX_FUTURE_S) continue;
        prices.set(f, {
          price: formatUnits(answer, FEED_DECIMALS),
          at: new Date(updated * 1e3).toISOString()
        });
      }
      const wallets = addresses.map((address) => ({
        address,
        assets: [],
        partial: false,
        warnings: []
      }));
      const mk = (symbol, id, decimals, raw, feed2) => {
        const p = prices.get(feed2);
        return {
          assetId: id,
          symbol,
          decimals,
          rawAmount: raw.toString(),
          amount: formatUnits(raw, decimals),
          price: p ? p.price : null,
          value: p ? valueUsd(raw, decimals, p.price) : null,
          priceSource: p ? `chainlink:${feed2}` : null,
          priceObservedAt: p ? p.at : null
        };
      };
      for (const p of plan) {
        const w2 = wallets[p.addr];
        const hex = out.get(p.idx);
        const t = p.token === null ? null : TOKENS[p.token];
        const label = t ? t.symbol : "ETH";
        const badLen = hex?.length !== 66;
        if (hex === null || hex === void 0 || badLen) {
          w2.partial = true;
          if (!w2.warnings.includes(`${label} balance could not be read; this is not a zero balance.`))
            w2.warnings.push(`${label} balance could not be read; this is not a zero balance.`);
          continue;
        }
        const raw = BigInt(hex);
        if (raw === 0n) continue;
        w2.assets.push(
          t ? mk(t.symbol, `eip155:1/erc20:${t.address}`, t.decimals, raw, t.feed) : mk("ETH", "eip155:1/native", 18, raw, "ETH/USD")
        );
      }
      for (const w2 of wallets) {
        w2.warnings.push(`Balances and prices were read together at Ethereum block ${blockNumber}.`);
      }
      for (const w2 of wallets)
        if (w2.assets.some((a) => a.price === null))
          w2.warnings.push(
            "Some prices are unavailable or stale; those values are Unknown, not zero."
          );
      if (opts?.aave) {
        const aaveRpc = async (to, data) => {
          const fail2 = (reason) => ({ ok: false, reason });
          const ctl = new AbortController();
          const onOuter = () => ctl.abort();
          if (signal.aborted) ctl.abort();
          else signal.addEventListener("abort", onOuter, { once: true });
          const timer = setTimeout(() => ctl.abort(), AAVE_DEADLINE_MS);
          try {
            let res2;
            try {
              res2 = await d.fetch(d.rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "eth_call",
                  params: [{ to, data }, "latest"]
                }),
                signal: ctl.signal,
                redirect: "manual"
              });
            } catch {
              return fail2(ctl.signal.aborted && !signal.aborted ? "timeout" : "unavailable");
            }
            if (res2.status === 429) return fail2("rate_limited");
            if (!res2.ok) return fail2("unavailable");
            let text2;
            try {
              text2 = await readCapped(res2, AAVE_MAX_RESPONSE_BYTES);
            } catch {
              return fail2(ctl.signal.aborted && !signal.aborted ? "timeout" : "unavailable");
            }
            if (text2 === null) return fail2("bad_response");
            let parsed2;
            try {
              parsed2 = JSON.parse(text2);
            } catch {
              return fail2("bad_response");
            }
            if (typeof parsed2 !== "object" || parsed2 === null || Array.isArray(parsed2))
              return fail2("bad_response");
            if (parsed2.jsonrpc !== "2.0" || parsed2.id !== 1) return fail2("bad_response");
            if (parsed2.error === void 0 === (parsed2.result === void 0))
              return fail2("bad_response");
            if (parsed2.error !== void 0) {
              const code = parsed2.error?.code;
              return fail2(code === -32005 || code === -32029 ? "rate_limited" : "unavailable");
            }
            if (typeof parsed2.result !== "string" || !HEX.test(parsed2.result))
              return fail2("bad_response");
            return { ok: true, result: parsed2.result };
          } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", onOuter);
          }
        };
        const sections = await readAaveV3PositionsForUsers(aaveRpc, {
          poolAddressesProvider: AAVE_POOL_ADDRESSES_PROVIDER,
          uiPoolDataProvider: AAVE_UI_POOL_DATA_PROVIDER,
          users: addresses
        });
        const feedFor = new Map(TOKENS.map((t) => [t.address.toLowerCase(), t.feed]));
        const view = (p) => {
          const feedId = feedFor.get(p.underlyingAsset.toLowerCase());
          const price = feedId ? prices.get(feedId) : void 0;
          const notes = [];
          if (!p.reserveFlags.isActive) notes.push("not active");
          if (p.reserveFlags.isFrozen) notes.push("frozen");
          if (p.reserveFlags.isPaused) notes.push("paused");
          return {
            underlyingAsset: p.underlyingAsset,
            symbol: p.symbol,
            decimals: p.decimals,
            supplied: formatUnits(p.suppliedRaw, p.decimals),
            variableDebt: formatUnits(p.variableDebtRaw, p.decimals),
            suppliedValueUsd: p.suppliedRaw === 0n ? "0" : price ? valueUsd(p.suppliedRaw, p.decimals, price.price) : null,
            variableDebtValueUsd: p.variableDebtRaw === 0n ? "0" : price ? valueUsd(p.variableDebtRaw, p.decimals, price.price) : null,
            priceSource: price && feedId ? `chainlink:${feedId}` : null,
            priceObservedAt: price ? price.at : null,
            // The reserve's stored-index observation time, never the fetch time.
            observedAt: new Date(Number(p.observedAt) * 1e3).toISOString(),
            usageAsCollateralEnabled: p.usageAsCollateralEnabled,
            reserveNote: notes.length ? `This reserve is ${notes.join(" and ")} on Aave.` : null
          };
        };
        wallets.forEach((w2, i) => {
          const s = sections.get(addresses[i]);
          if (!s || s.kind === "unavailable") {
            w2.aave = {
              status: "unavailable",
              reason: !s || s.reason === "bad_payload" || s.reason === "bad_response" ? "bad_response" : s.reason
            };
            return;
          }
          w2.aave = { status: "ok", positions: s.positions.map(view) };
        });
      }
      return {
        ok: true,
        provider: "publicnode-rpc+chainlink",
        simulated: false,
        observedAt: d.now().toISOString(),
        wallets
      };
    }
  };
}

// server/portfolio/live-provider-solana.ts
var SOLANA_RPC_URL = "https://solana-rpc.publicnode.com";
var SOLANA_RPC_FALLBACK_URL = "https://api.mainnet.solana.com";
var SOL_DECIMALS = 9;
var SOL_USD_FEED = {
  address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  heartbeatS: 86400,
  maxAgeS: 86400 + HEARTBEAT_GRACE_S
};
var HEX2 = /^0x[0-9a-fA-F]+$/;
var word2 = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
var isSafeRpcCode2 = (c) => typeof c === "number" && Number.isSafeInteger(c) && Math.abs(c) <= 1e6;
function createSolanaLiveProvider(over = {}) {
  const d = {
    fetch: (...a) => fetch(...a),
    now: () => /* @__PURE__ */ new Date(),
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaFallbackRpcUrl: SOLANA_RPC_FALLBACK_URL,
    ethRpcUrl: RPC_URL,
    ...over
  };
  const NAME = "publicnode-solana+chainlink";
  const FAILOVER_NAME = "solana-public-rpc+chainlink";
  return {
    name: NAME,
    simulated: false,
    async fetchWallets(addresses, signal) {
      let diag = { step: "build" };
      const fail = (kind) => ({ ok: false, provider: NAME, kind, diag });
      const calls = [
        { target: MULTICALL3, allowFailure: false, data: SEL_GET_BLOCK_NUMBER },
        { target: MULTICALL3, allowFailure: false, data: SEL_GET_CURRENT_BLOCK_TIMESTAMP },
        { target: SOL_USD_FEED.address, allowFailure: true, data: SEL_DECIMALS },
        { target: SOL_USD_FEED.address, allowFailure: true, data: SEL_LATEST_ROUND_DATA }
      ];
      diag = { step: "request", calls: calls.length + addresses.length };
      let res;
      try {
        res = await d.fetch(d.ethRpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: MULTICALL3, data: encodeAggregate3(calls) }, "latest"]
          }),
          signal,
          redirect: "manual"
        });
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      diag = { step: "response", calls: calls.length + addresses.length, http: res.status };
      if (res.status === 429) return fail("rate_limited");
      if (!res.ok) return fail("unavailable");
      let text;
      try {
        text = await readCapped(res, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      if (text === null) return fail("bad_response");
      let ethParsed;
      try {
        ethParsed = JSON.parse(text);
      } catch {
        return fail("bad_response");
      }
      if (ethParsed.jsonrpc !== "2.0" || ethParsed.id !== 1) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      if (ethParsed.error !== void 0) {
        const code = ethParsed.error?.code;
        diag = {
          ...diag,
          step: "rpc_error",
          ...isSafeRpcCode2(code) ? { rpcCode: code } : {}
        };
        return fail(code === -32005 || code === -32029 ? "rate_limited" : "unavailable");
      }
      if (typeof ethParsed.result !== "string") return fail("bad_response");
      const results = decodeAggregate3(ethParsed.result, calls.length);
      if (!results) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      const get = (i) => {
        const r = results[i];
        return r.success && HEX2.test(r.data) ? r.data : null;
      };
      const bnHex = get(0);
      const tsHex = get(1);
      if (!bnHex || bnHex.length !== 66 || !tsHex || tsHex.length !== 66) {
        diag = { ...diag, step: "block_info" };
        return fail("bad_response");
      }
      const chainS = BigInt(tsHex);
      if (chainS === 0n || chainS > BigInt(Number.MAX_SAFE_INTEGER)) {
        diag = { ...diag, step: "block_info" };
        return fail("bad_response");
      }
      const localS = Math.floor(d.now().getTime() / 1e3);
      if (Math.abs(localS - Number(chainS)) > MAX_CLOCK_SKEW_S) {
        diag = { ...diag, step: "stale_node" };
        return fail("bad_response");
      }
      const nowS = Number(chainS);
      let price = null;
      const dec = get(2);
      const round = get(3);
      if (dec && dec.length === 66 && round && round.length === 2 + 5 * 64) {
        if (BigInt(dec) === BigInt(FEED_DECIMALS)) {
          const roundId = BigInt("0x" + word2(round, 0));
          const answer = BigInt("0x" + word2(round, 1));
          const started = BigInt("0x" + word2(round, 2));
          const updatedBig = BigInt("0x" + word2(round, 3));
          if (roundId !== 0n && started !== 0n && updatedBig !== 0n && started <= updatedBig && answer > 0n && answer < 1n << 255n && updatedBig <= BigInt(Number.MAX_SAFE_INTEGER)) {
            const updated = Number(updatedBig);
            if (nowS - updated <= SOL_USD_FEED.maxAgeS && updated - nowS <= MAX_FUTURE_S)
              price = { price: formatUnits(answer, FEED_DECIMALS), at: new Date(updated * 1e3).toISOString() };
          }
        }
      }
      diag = { step: "request", calls: calls.length + addresses.length };
      const solanaBody = JSON.stringify(
        addresses.map((a, i) => ({
          jsonrpc: "2.0",
          id: i + 1,
          method: "getBalance",
          params: [a, { commitment: "finalized" }]
        }))
      );
      const postSolana = (url) => d.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: solanaBody,
        signal,
        redirect: "manual"
      });
      let sres;
      try {
        sres = await postSolana(d.solanaRpcUrl);
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      let solanaVia = "primary";
      if (sres.status === 429 && d.solanaFallbackRpcUrl && d.solanaFallbackRpcUrl !== d.solanaRpcUrl) {
        try {
          sres = await postSolana(d.solanaFallbackRpcUrl);
          solanaVia = "fallback";
        } catch {
          return fail(signal.aborted ? "timeout" : "unavailable");
        }
      }
      diag = { step: "response", calls: calls.length + addresses.length, http: sres.status };
      if (sres.status === 429) return fail("rate_limited");
      if (!sres.ok) return fail("unavailable");
      let stext;
      try {
        stext = await readCapped(sres, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? "timeout" : "unavailable");
      }
      if (stext === null) return fail("bad_response");
      const balanceObservedAt = d.now().toISOString();
      let items;
      try {
        items = JSON.parse(stext);
      } catch {
        return fail("bad_response");
      }
      if (!Array.isArray(items)) {
        diag = { ...diag, step: "decode" };
        return fail("bad_response");
      }
      const byId = /* @__PURE__ */ new Map();
      for (const it of items) {
        if (typeof it === "object" && it !== null && typeof it.id === "number") byId.set(it.id, it);
      }
      let slot = null;
      const wallets = addresses.map((address, i) => {
        const w2 = { address, assets: [], partial: false, warnings: [] };
        const it = byId.get(i + 1);
        if (!it || it.jsonrpc !== "2.0") {
          w2.partial = true;
          w2.warnings.push("SOL balance could not be read; this is not a zero balance.");
          return w2;
        }
        if (it.error) {
          w2.partial = true;
          w2.warnings.push("SOL balance could not be read; this is not a zero balance.");
          return w2;
        }
        const r = it.result;
        const lamports = r?.value;
        const itSlot = r?.context?.slot;
        if (typeof lamports !== "number" || !Number.isSafeInteger(lamports) || lamports < 0 || typeof itSlot !== "number" || !Number.isSafeInteger(itSlot)) {
          w2.partial = true;
          w2.warnings.push("SOL balance could not be read; this is not a zero balance.");
          return w2;
        }
        if (slot === null) slot = itSlot;
        if (lamports > 0) {
          const raw = BigInt(lamports);
          const a = {
            assetId: "solana:mainnet/native",
            symbol: "SOL",
            decimals: SOL_DECIMALS,
            rawAmount: raw.toString(),
            amount: formatUnits(raw, SOL_DECIMALS),
            price: price ? price.price : null,
            value: price ? valueUsd(raw, SOL_DECIMALS, price.price) : null,
            priceSource: price ? "chainlink:SOL/USD" : null,
            priceObservedAt: price ? price.at : null
          };
          w2.assets.push(a);
        }
        return w2;
      });
      for (const w2 of wallets) {
        if (slot !== null)
          w2.warnings.push(
            `Balances were read together at Solana slot ${slot}. The USD reference price is the Chainlink SOL/USD feed on Ethereum mainnet, updated ${price ? price.at : "unknown"}.`
          );
        else
          w2.warnings.push(
            "The Solana slot could not be read; balance freshness cannot be shown."
          );
      }
      for (const w2 of wallets)
        if (w2.assets.some((a) => a.price === null) && !w2.warnings.some((x) => x.includes("price")))
          w2.warnings.push(
            "A USD price was unavailable; values are shown without it. An unpriced asset is not a zero balance."
          );
      return {
        ok: true,
        provider: solanaVia === "fallback" ? FAILOVER_NAME : NAME,
        simulated: false,
        observedAt: balanceObservedAt,
        wallets
      };
    }
  };
}

// server/portfolio/sync.ts
var json3 = (status, body, headers) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }
});
var SYNC_WINDOWS = [{ limit: 10, windowMs: 6e5 }];
var SYNC_TIMEOUT_MS = 25e3;
var defaultSyncDeps = () => ({
  ethereum: createLiveProvider(),
  solana: createSolanaLiveProvider(),
  timeoutMs: SYNC_TIMEOUT_MS
});
async function readNetwork(provider, addresses, network, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const result = await provider.fetchWallets(addresses, ctl.signal, { aave: network === "ethereum" });
    if (!result.ok) return { error: result.kind };
    if (result.simulated) return { error: "simulated_refused" };
    return result;
  } catch {
    return { error: ctl.signal.aborted ? "timeout" : "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}
async function handleSync(req, env, deps = defaultSyncDeps()) {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST")
    return json3(405, { error: "method_not_allowed", requestId }, { allow: "POST" });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== "true" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json3(503, { error: "unavailable", requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const userId = identity.userId;
  const lim = await createD1Limiter(db, SYNC_WINDOWS, "portfolio_sync").check(userId);
  if (!lim.allowed)
    return json3(429, { error: "rate_limited", retryAfterSec: lim.retryAfterSec, requestId });
  if (!await hasSnapshotConsent(db, userId))
    return json3(200, { status: "ok", recorded: false, reason: "no_consent", requestId });
  if (env.PORTFOLIO_LIVE_DATA !== "1")
    return json3(503, { error: "live_data_off", message: "Live chain reads are switched off on this deployment.", requestId });
  const rows = await db.prepare(
    `SELECT pa.network AS network, pa.address AS address
         FROM portfolio_addresses pa
         JOIN portfolios p ON p.id = pa.portfolio_id
        WHERE p.user_id = ? AND pa.removed_at IS NULL
        ORDER BY pa.created_at ASC`
  ).bind(userId).all();
  const byNetwork = { ethereum: [], solana: [] };
  for (const r of rows.results)
    if (r.network === "ethereum" || r.network === "solana") byNetwork[r.network].push(r.address);
  if (byNetwork.ethereum.length + byNetwork.solana.length === 0)
    return json3(200, { status: "ok", recorded: false, reason: "no_addresses", requestId });
  const runs = [];
  for (const network of ["ethereum", "solana"]) {
    const addresses = byNetwork[network];
    if (addresses.length === 0) continue;
    const result = await readNetwork(deps[network], addresses, network, deps.timeoutMs);
    if ("error" in result) {
      runs.push({ network, recorded: false, reason: result.error });
      continue;
    }
    const outcome = await recordObservation(db, userId, result, () => network);
    runs.push(
      outcome.recorded ? {
        network,
        recorded: true,
        balances: outcome.balances,
        positions: outcome.positions,
        prices: outcome.prices,
        skippedDuplicates: outcome.skippedDuplicates,
        observedAt: result.observedAt
      } : { network, recorded: false, reason: outcome.reason }
    );
  }
  return json3(200, { status: "ok", recorded: runs.some((r) => r.recorded), runs, requestId });
}

// server/portfolio/history.ts
var NETWORKS = ["ethereum", "solana"];
async function loadBalanceHistory(db, userId) {
  const networks = [];
  for (const network of NETWORKS) {
    const times = await db.prepare(
      `SELECT DISTINCT bs.observed_at AS t
           FROM balance_snapshots bs
           JOIN portfolios pf ON pf.id = bs.portfolio_id
           JOIN sync_runs sr ON sr.id = bs.sync_run_id
          WHERE pf.user_id = ? AND sr.completeness = 'complete' AND bs.network = ?
          ORDER BY bs.observed_at DESC
          LIMIT 2`
    ).bind(userId, network).all();
    if (times.results.length === 0) continue;
    const load = async (t) => (await db.prepare(
      `SELECT bs.asset_id AS assetId, bs.network AS network, bs.address AS address,
                    'wallet_balance' AS kind, bs.amount AS amount, bs.observed_at AS observedAt
               FROM balance_snapshots bs
               JOIN portfolios pf ON pf.id = bs.portfolio_id
               JOIN sync_runs sr ON sr.id = bs.sync_run_id
              WHERE pf.user_id = ? AND bs.observed_at = ? AND bs.network = ?
                AND sr.completeness = 'complete'
              ORDER BY bs.asset_id`
    ).bind(userId, t, network).all()).results;
    const latestObservedAt2 = times.results[0].t;
    networks.push({
      network,
      latestObservedAt: latestObservedAt2,
      latest: await load(latestObservedAt2),
      prior: times.results.length === 2 ? await load(times.results[1].t) : null
    });
  }
  const latestObservedAt = networks.length === 0 ? null : networks.map((n) => n.latestObservedAt).sort().reverse()[0];
  const partialNewer = await db.prepare(
    `SELECT 1 AS ok FROM balance_snapshots bs
         JOIN portfolios pf ON pf.id = bs.portfolio_id
         JOIN sync_runs sr ON sr.id = bs.sync_run_id
        WHERE pf.user_id = ? AND sr.completeness = 'partial'
          AND bs.observed_at > COALESCE(?, '')
        LIMIT 1`
  ).bind(userId, latestObservedAt).first();
  const newerPartial = partialNewer !== null;
  if (networks.length === 0) return { latestObservedAt: null, newerPartial, prior: null, latest: [], networks: [] };
  const latest = networks.flatMap((n) => n.latest);
  const priors = networks.flatMap((n) => n.prior ?? []);
  return {
    latestObservedAt,
    newerPartial,
    prior: priors.length > 0 ? priors : null,
    latest,
    networks
  };
}

// server/portfolio/overview-handler.ts
var json4 = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});
async function handleOverview(req, env) {
  if (req.method !== "GET") return json4(405, { error: "method_not_allowed" });
  if (env.PORTFOLIO_ACCOUNTS !== "1" || !env.PORTFOLIO_ACCOUNTS_DB)
    return json4(503, { error: "disabled", message: "This feature is switched off." });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  try {
    const h = await loadBalanceHistory(db, identity.userId);
    if (!h.latestObservedAt)
      return json4(200, {
        status: "empty",
        reason: "no_recorded_observations",
        newerPartial: h.newerPartial
      });
    return json4(200, {
      status: "ok",
      // Spot balances only; Solana coverage is the SOL balance only (no SPL
      // tokens/NFTs) - "no Solana rows" never means "empty Solana wallet".
      scope: "spot_balances_only",
      solanaScope: "sol_only",
      latestCompleteObservedAt: h.latestObservedAt,
      newerPartial: h.newerPartial,
      latest: h.latest,
      prior: h.prior,
      // Per-network slices with their own timestamps: the honest baseline for
      // deltas (reviewer MEDIUM - never compare one network against another).
      networks: h.networks
    });
  } catch {
    return json4(503, { error: "storage_unavailable", message: "History storage is unavailable. Try again later." });
  }
}

// server/portfolio/provider.ts
var OBSERVED = "2026-01-01T00:00:00.000Z";
function asset(r) {
  return {
    assetId: r.id,
    symbol: r.symbol,
    decimals: r.decimals,
    rawAmount: r.raw.toString(),
    amount: formatUnits(r.raw, r.decimals),
    price: r.price,
    value: r.price === null ? null : valueUsd(r.raw, r.decimals, r.price),
    priceSource: r.price === null ? null : "mock-fixture",
    priceObservedAt: r.price === null ? null : OBSERVED
  };
}
var ETH = (raw, price = "2000") => ({
  id: "eip155:1/native",
  symbol: "ETH",
  decimals: 18,
  raw,
  price
});
var USDC = (raw) => ({
  id: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  symbol: "USDC",
  decimals: 6,
  raw,
  price: "1"
});
var MYSTERY = {
  id: "eip155:1/erc20:0x0000000000000000000000000000000000001234",
  symbol: "MYST",
  decimals: 9,
  raw: 5000000000n,
  price: null
};
var SCENARIOS = {
  "0": { name: "empty wallet", raws: [], warnings: [] },
  "1": { name: "native only", raws: [ETH(1500000000000000000n)], warnings: [] },
  "2": {
    name: "mixed tokens",
    raws: [ETH(250000000000000000n), USDC(1234560000n)],
    warnings: []
  },
  "3": {
    name: "unknown price",
    raws: [ETH(10n ** 18n), MYSTERY],
    warnings: ["One asset has no price and is excluded from the subtotal."]
  },
  "4": { name: "very large quantity", raws: [{ ...USDC(10n ** 30n) }], warnings: [] },
  "5": {
    name: "partial data",
    raws: [ETH(10n ** 18n)],
    warnings: [
      "Some token data could not be loaded. This result cannot tell you whether the wallet is empty."
    ],
    partial: true
  }
};
var DEFAULT = SCENARIOS["2"];
var MOCK_AAVE = {
  "0": { status: "ok", positions: [] },
  // a true empty: no positions exist for this fixture
  "2": {
    status: "ok",
    positions: [
      {
        underlyingAsset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        symbol: "USDC",
        decimals: 6,
        supplied: "500.25",
        variableDebt: "0",
        suppliedValueUsd: "500.25",
        variableDebtValueUsd: "0",
        priceSource: "mock-fixture",
        priceObservedAt: OBSERVED,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: true,
        reserveNote: null
      },
      {
        underlyingAsset: "0x6b175474e89094c44da98b954eedeac495271d0f",
        symbol: "DAI",
        decimals: 18,
        supplied: "0",
        variableDebt: "120.5",
        suppliedValueUsd: "0",
        variableDebtValueUsd: "120.5",
        priceSource: "mock-fixture",
        priceObservedAt: OBSERVED,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: false,
        reserveNote: null
      }
    ]
  },
  "3": {
    status: "ok",
    positions: [
      {
        underlyingAsset: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
        symbol: "UNI",
        decimals: 18,
        supplied: "42",
        variableDebt: "0",
        suppliedValueUsd: null,
        // no verified feed price: Unknown, never zero
        variableDebtValueUsd: "0",
        priceSource: null,
        priceObservedAt: null,
        observedAt: OBSERVED,
        usageAsCollateralEnabled: true,
        reserveNote: null
      }
    ]
  },
  a: { status: "unavailable", reason: "unavailable" }
};
var mockProvider = {
  name: "mock-fixtures",
  simulated: true,
  async fetchWallets(addresses, _signal, opts) {
    const last = (a) => a.slice(-1).toLowerCase();
    if (addresses.some((a) => last(a) === "f"))
      return { ok: false, provider: "mock-fixtures", kind: "unavailable" };
    if (addresses.some((a) => last(a) === "e"))
      return { ok: false, provider: "mock-fixtures", kind: "rate_limited" };
    if (addresses.some((a) => last(a) === "d"))
      return { ok: false, provider: "mock-fixtures", kind: "timeout" };
    const wallets = addresses.map((address) => {
      const sc = SCENARIOS[last(address)] ?? DEFAULT;
      const aave = opts?.aave ? MOCK_AAVE[last(address)] : void 0;
      return {
        address,
        assets: sc.raws.map(asset),
        partial: sc.partial ?? false,
        warnings: sc.warnings,
        ...aave !== void 0 ? { aave } : {}
      };
    });
    return { ok: true, provider: "mock-fixtures", simulated: true, observedAt: OBSERVED, wallets };
  }
};
var solanaMockProvider = {
  name: "mock-fixtures-solana",
  simulated: true,
  async fetchWallets(addresses) {
    const wallets = addresses.map((address) => ({
      address,
      assets: [
        asset({
          id: "solana:mainnet/native",
          symbol: "SOL",
          decimals: 9,
          raw: 12345678901n,
          price: "200"
        })
      ],
      partial: false,
      warnings: []
    }));
    return {
      ok: true,
      provider: "mock-fixtures-solana",
      simulated: true,
      observedAt: OBSERVED,
      wallets
    };
  }
};

// harness/fixture-native-worker.ts
var MIGRATIONS = [accounts_and_counters_default, native_auth_default, portfolio_user_unique_default].flatMap(
  (sql) => sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean)
);
async function migrate(db) {
  for (const stmt of MIGRATIONS) await db.prepare(stmt).run();
}
var syncDeps = {
  ethereum: mockProvider,
  solana: solanaMockProvider,
  timeoutMs: 5e3
};
function envFor(db) {
  return {
    PORTFOLIO_ACCOUNTS_DB: db,
    NATIVE_AUTH_ENABLED: "true",
    PORTFOLIO_ACCOUNTS: "1",
    PORTFOLIO_LIVE_DATA: "1"
  };
}
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var fixture_native_worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const db = env.DB;
    await migrate(db);
    if (url.pathname === "/fixture/seed-native") {
      const email = url.searchParams.get("email") ?? "owner@example.com";
      const userId = `user-${crypto.randomUUID()}`;
      const sessionId = crypto.randomUUID();
      const t = now();
      await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(userId, "active", t, t).run();
      await db.prepare(
        "INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at, metadata) VALUES (?, ?, ?, ?, ?, NULL)"
      ).bind(`idn-${crypto.randomUUID()}`, userId, "email", email, t).run();
      await db.prepare(
        "INSERT INTO entitlements (id, email, wallet_chain, wallet_address, invite_code, granted_by, created_at, revoked_at) VALUES (?, ?, NULL, NULL, NULL, ?, ?, NULL)"
      ).bind(`ent-${crypto.randomUUID()}`, email, "fixture", t).run();
      await db.prepare(
        "INSERT INTO sessions (id, user_id, created_at, expires_at, rotated_from, revoked_at, ip_hash, ua_hash) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)"
      ).bind(sessionId, userId, t, new Date(Date.now() + 36e5).toISOString()).run();
      return new Response(JSON.stringify({ session: sessionId, userId }), {
        headers: { "content-type": "application/json" }
      });
    }
    const env2 = envFor(db);
    switch (url.pathname) {
      case "/api/v1/portfolio/addresses":
        return req.method === "GET" ? handleAddressesList(req, env2) : handleAddressAdd(req, env2);
      case "/api/v1/portfolio/addresses/rename":
        return handleAddressRename(req, env2);
      case "/api/v1/portfolio/addresses/remove":
        return handleAddressRemove(req, env2);
      case "/api/v1/portfolio/snapshots/consent":
        return req.method === "GET" ? handleSnapshotConsentStatus(req, env2) : handleSnapshotConsentChange(req, env2);
      case "/api/v1/portfolio/sync":
        return handleSync(req, env2, syncDeps);
      case "/api/v1/portfolio/overview":
        return handleOverview(req, env2);
      default:
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
    }
  }
};
export {
  fixture_native_worker_default as default
};
