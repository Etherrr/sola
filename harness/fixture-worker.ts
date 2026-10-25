// SANDBOX FIXTURE — never ships. Wires the REAL production handlers (handleAccounts,
// handleSession) to a local workerd D1 binding with a locally generated RS256 keypair.
// The Access JWT is genuinely verified (jose: signature, iss, aud, exp) against the fixture
// JWKS through the real checkAccessJwt — the production JWT code path is unchanged; only the
// key SOURCE is a fixture (the fetchKeys dependency seam the handlers already expose).
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { handleAccounts, type AccountsDeps, type AccountsEnv } from '/tmp/codex-review/server/accounts/handler';
import { handleSession, type Deps } from '/tmp/codex-review/server/portfolio/handler';
import { mockProvider, solanaMockProvider } from '/tmp/codex-review/server/portfolio/provider';
import type { Jwk } from '/tmp/codex-review/server/portfolio/access';

const MIGRATION_SQL: string = "-- Applied once, only after the owner approves creating the D1 binding.\n-- Mirrors server/accounts/d1.ts SCHEMA_SQL + COUNTERS_SQL; keep in sync.\nCREATE TABLE IF NOT EXISTS tracked_addresses (\n  owner_issuer_subject TEXT NOT NULL,\n  network TEXT NOT NULL CHECK (network IN ('ethereum', 'solana')),\n  address TEXT NOT NULL,\n  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (owner_issuer_subject, network, address)\n);\nCREATE TABLE IF NOT EXISTS rate_counters (\n  scope TEXT NOT NULL,\n  owner TEXT NOT NULL,\n  window_start INTEGER NOT NULL,\n  window_ms INTEGER NOT NULL,\n  count INTEGER NOT NULL CHECK (count >= 0),\n  PRIMARY KEY (scope, owner, window_start, window_ms)\n);\n";
const MIGRATION = MIGRATION_SQL.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'fixture-aud';

type Keys = { privateKey: CryptoKey; jwks: Jwk[] };
let keysP: Promise<Keys> | null = null;
function keys(): Promise<Keys> {
  if (!keysP) {
    keysP = (async () => {
      const { publicKey, privateKey } = await generateKeyPair('RS256');
      const jwk = (await exportJWK(publicKey)) as Jwk;
      jwk.kid = 'fixture-1';
      jwk.alg = 'RS256';
      return { privateKey, jwks: [jwk] };
    })();
  }
  return keysP;
}

const fetchKeys = async () => (await keys()).jwks;

function accountsDeps(): AccountsDeps {
  return { fetchKeys, now: () => new Date(), id: () => crypto.randomUUID(), bodyDeadlineMs: 3000 };
}
function sessionDeps(): Deps {
  return {
    provider: mockProvider, liveProvider: mockProvider,
    solanaProvider: solanaMockProvider, solanaLiveProvider: solanaMockProvider,
    fetchKeys, now: () => new Date(), id: () => crypto.randomUUID(),
    timeoutMs: 3000, bodyDeadlineMs: 3000,
  };
}

const ENV: AccountsEnv & { PORTFOLIO_API_ENABLED: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string } = {
  PORTFOLIO_API_ENABLED: 'true',
  PORTFOLIO_ACCOUNTS: '1', // enabled HERE only, against the local binding
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
};

let migrated = false;
async function migrate(db: any) {
  if (migrated) return;
  for (const stmt of MIGRATION) await db.prepare(stmt).run();
  migrated = true;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: { DB: any }): Promise<Response> {
    const url = new URL(req.url);
    // Harness-only fixture route: mints a REAL signed JWT for a synthetic identity. This
    // route does not exist in production code; it plays the role Cloudflare Access plays at
    // the edge (issuing + injecting the assertion) inside the sandbox only.
    if (url.pathname === '/fixture/mint') {
      const sub = url.searchParams.get('sub') ?? 'user-a';
      const email = url.searchParams.get('email') ?? 'a@example.com';
      const { privateKey } = await keys();
      const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture-1' })
        .setIssuer(`https://${TEAM}`)
        .setAudience(AUD)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
      return json(200, { token });
    }
    await migrate(env.DB);
    const fullEnv = { ...ENV, PORTFOLIO_ACCOUNTS_DB: env.DB };
    if (url.pathname === '/api/v1/portfolio/accounts')
      return handleAccounts(req, fullEnv, accountsDeps());
    if (url.pathname === '/api/v1/session')
      return handleSession(req, fullEnv as never, sessionDeps());
    return json(404, { error: { code: 'not_found', message: 'fixture worker' } });
  },
};
