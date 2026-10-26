// SANDBOX FIXTURE - never ships. Wires the REAL v0.2-native production handlers
// (addresses, snapshot consent, sync, overview) to a local workerd D1 binding with
// migrations 0002-0004 applied for real (0004 = claims; fixture-local schema). Identity is seeded straight into D1
// (user + verified email identity + entitlement + live session) - no auth code is
// weakened; every request still passes the unchanged requireEntitledSession gate.
import mig1 from '../migrations/0001_accounts_and_counters.sql';
import mig2 from '../migrations/0002_native_auth.sql';
import mig3 from '../migrations/0003_portfolio_user_unique.sql';
import mig4 from '../migrations/0004_claims.sql';
import {
  handleAddressesList,
  handleAddressAdd,
  handleAddressRename,
  handleAddressRemove,
} from '../server/portfolio/addresses';
import {
  handleSnapshotConsentStatus,
  handleSnapshotConsentChange,
} from '../server/portfolio/consent';
import { handleSync, type SyncDeps } from '../server/portfolio/sync';
import {
  handleClaimAttempt,
  handleClaimPreview,
  handleClaimReport,
  handleClaimRollback,
  type ClaimDeps,
  type ClaimEnv,
} from '../server/claim/routes';
import { claimAttemptParam, claimMountGate } from '../server/claim/mount';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import type { Jwk } from '../server/portfolio/access';
import { handleOverview } from '../server/portfolio/overview-handler';
import { mockProvider, solanaMockProvider, type PortfolioProvider, type ProviderResult } from '../server/portfolio/provider';
import type { D1Like } from '../server/accounts/d1';

// Production applies 0001 (rate_counters + legacy tables) and 0002; 0003 is the pending
// production migration exercised here on the same footing.
const MIGRATIONS = [mig1, mig2, mig3, mig4].flatMap((sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean),
);

async function migrate(db: D1Like) {
  for (const stmt of MIGRATIONS) await db.prepare(stmt).bind().run();
}

/** Harness-only recordable fixture: deterministic invented values whose RESULT declares
 *  simulated:false at the provider seam, so the unchanged production sync handler persists
 *  them. This exercises record/withdrawal handler semantics in the sandbox only; the
 *  production guard refusing simulated reads (server/portfolio/sync.ts) is untouched and
 *  pinned by an explicit spec. Header x-fixture-provider: simulated selects the genuine
 *  simulated providers instead (the refusal path). */
const recordable = (
  name: string,
  assetId: string,
  symbol: string,
  decimals: number,
  rawAmount: string,
  amount: string,
  price: string,
  value: string,
): PortfolioProvider => ({
  name,
  simulated: false,
  async fetchWallets(addresses: string[]): Promise<ProviderResult> {
    const at = new Date().toISOString();
    return {
      ok: true,
      provider: name,
      simulated: false,
      observedAt: at,
      wallets: addresses.map((address) => ({
        address,
        assets: [
          { assetId, symbol, decimals, rawAmount, amount, price, value, priceSource: name, priceObservedAt: at },
        ],
        partial: false,
        warnings: [],
      })),
    };
  },
});

const recordableDeps: SyncDeps = {
  ethereum: recordable('harness-recordable-fixture', 'eip155:1/native', 'ETH', 18, '1250000000000000000', '1.25', '2000', '2500'),
  solana: recordable('harness-recordable-fixture-solana', 'solana:mainnet/native', 'SOL', 9, '2500000000', '2.5', '100', '250'),
  timeoutMs: 5000,
};
const simulatedDeps: SyncDeps = {
  ethereum: mockProvider,
  solana: solanaMockProvider,
  timeoutMs: 5000,
};

function envFor(db: D1Like) {
  return {
    PORTFOLIO_ACCOUNTS_DB: db,
    NATIVE_AUTH_ENABLED: 'true',
    PORTFOLIO_ACCOUNTS: '1',
    PORTFOLIO_LIVE_DATA: '1',
  };
}

const now = () => new Date().toISOString();

// Claim fixture support (SANDBOX ONLY): the claim handlers re-validate the Cloudflare
// Access assertion at claim time through the real checkAccessJwt; the fixture mints
// genuine RS256 JWTs locally and injects the JWKS through the fetchKeys seam - no
// network, no real Access. CLAIM_ENABLED is '1' HERE only, against the local binding
// with the real 0004 schema applied; it ships absent everywhere else.
const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'fixture-aud';
type Keys = { privateKey: CryptoKey; jwks: Jwk[] };
let keysP: Promise<Keys> | null = null;
function keys(): Promise<Keys> {
  if (!keysP) {
    keysP = (async () => {
      const { publicKey, privateKey } = await generateKeyPair('RS256');
      const jwk = (await exportJWK(publicKey)) as Jwk;
      jwk.kid = 'fixture-native-1';
      jwk.alg = 'RS256';
      return { privateKey, jwks: [jwk] };
    })();
  }
  return keysP;
}
function claimDepsF(): ClaimDeps {
  return { fetchKeys: async () => (await keys()).jwks, now: () => new Date(), id: () => crypto.randomUUID() };
}
function claimEnv(db: D1Like): ClaimEnv {
  return {
    ...envFor(db),
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    CLAIM_ENABLED: '1', // fixture-local binding + real 0004 only; ships absent elsewhere
  } as unknown as ClaimEnv;
}

export default {
  async fetch(req: Request, env: { DB: D1Like }): Promise<Response> {
    const url = new URL(req.url);
    const db = env.DB;
    await migrate(db);

    if (url.pathname === '/fixture/seed-native') {
      const email = url.searchParams.get('email') ?? 'owner@example.com';
      const userId = `user-${crypto.randomUUID()}`;
      const sessionId = crypto.randomUUID();
      const t = now();
      await db
        .prepare('INSERT INTO users (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(userId, 'active', t, t)
        .run();
      await db
        .prepare(
          'INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at, metadata) VALUES (?, ?, ?, ?, ?, NULL)',
        )
        .bind(`idn-${crypto.randomUUID()}`, userId, 'email', email, t)
        .run();
      await db
        .prepare(
          'INSERT INTO entitlements (id, email, wallet_chain, wallet_address, invite_code, granted_by, created_at, revoked_at) VALUES (?, ?, NULL, NULL, NULL, ?, ?, NULL)',
        )
        .bind(`ent-${crypto.randomUUID()}`, email, 'fixture', t)
        .run();
      await db
        .prepare(
          'INSERT INTO sessions (id, user_id, created_at, expires_at, rotated_from, revoked_at, ip_hash, ua_hash) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)',
        )
        .bind(sessionId, userId, t, new Date(Date.now() + 3600_000).toISOString())
        .run();
      return new Response(JSON.stringify({ session: sessionId, userId }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/fixture/mint') {
      const sub = url.searchParams.get('sub') ?? 'user-a';
      const email = url.searchParams.get('email') ?? 'a@example.com';
      const { privateKey } = await keys();
      const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture-native-1' })
        .setIssuer(`https://${TEAM}`)
        .setAudience(AUD)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
      return new Response(JSON.stringify({ token }), { headers: { 'content-type': 'application/json' } });
    }

    const env2 = envFor(db);
    // Claim endpoints: the SAME routing-layer gate as the production mounts, then the
    // real handlers with fixture deps (fixture JWKS via the fetchKeys seam).
    if (url.pathname === '/api/v1/claim/preview' || url.pathname === '/api/v1/claim/attempt') {
      const cEnv = claimEnv(db);
      const blocked = claimMountGate(cEnv, crypto.randomUUID());
      if (blocked) return blocked;
      return url.pathname.endsWith('preview')
        ? handleClaimPreview(req, cEnv, claimDepsF())
        : handleClaimAttempt(req, cEnv, claimDepsF());
    }
    const claimMatch = /^\/api\/v1\/claim\/(report|rollback)\/([^/]+)$/.exec(url.pathname);
    if (claimMatch) {
      const cEnv = claimEnv(db);
      const blocked = claimMountGate(cEnv, crypto.randomUUID());
      if (blocked) return blocked;
      const attemptId = claimAttemptParam({ attemptId: decodeURIComponent(claimMatch[2]) });
      return claimMatch[1] === 'report'
        ? handleClaimReport(req, cEnv, claimDepsF(), attemptId)
        : handleClaimRollback(req, cEnv, claimDepsF(), attemptId);
    }
    switch (url.pathname) {
      case '/api/v1/portfolio/addresses':
        return req.method === 'GET' ? handleAddressesList(req, env2) : handleAddressAdd(req, env2);
      case '/api/v1/portfolio/addresses/rename':
        return handleAddressRename(req, env2);
      case '/api/v1/portfolio/addresses/remove':
        return handleAddressRemove(req, env2);
      case '/api/v1/portfolio/snapshots/consent':
        return req.method === 'GET'
          ? handleSnapshotConsentStatus(req, env2)
          : handleSnapshotConsentChange(req, env2);
      case '/api/v1/portfolio/sync':
        return handleSync(req, env2, req.headers.get('x-fixture-provider') === 'simulated' ? simulatedDeps : recordableDeps);
      case '/api/v1/portfolio/overview':
        return handleOverview(req, env2);
      default:
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
    }
  },
};
