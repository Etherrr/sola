// The only browser code allowed to make a network request: a same-origin POST to our own
// read-only API. Public addresses only. Never calls a data provider directly.
export type ApiAsset = {
  assetId: string;
  symbol: string;
  decimals: number;
  amount: string;
  price: string | null;
  value: string | null;
  /** Where the price came from and the time that source itself last updated it (not the request time). */
  priceSource?: string | null;
  priceObservedAt?: string | null;
};
/** One Aave V3 reserve position: supplied and variable-debt balances only (never all debt). */
export type ApiAavePosition = {
  underlyingAsset: string;
  symbol: string;
  decimals: number;
  supplied: string;
  variableDebt: string;
  suppliedValueUsd: string | null;
  variableDebtValueUsd: string | null;
  priceSource: string | null;
  priceObservedAt: string | null;
  /** The reserve's stored-index observation time (not the request or fetch time). */
  observedAt: string;
  usageAsCollateralEnabled: boolean;
  reserveNote: string | null;
};
export type ApiAaveSection =
  | { status: 'ok'; positions: ApiAavePosition[] }
  | { status: 'unavailable'; reason: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response' };
export type ApiWallet = {
  address: string;
  assets: ApiAsset[];
  partial: boolean;
  warnings: string[];
  aave?: ApiAaveSection;
};
export type ApiSuccess = {
  mode: 'mock' | 'live';
  simulated: boolean;
  provider: string;
  generatedAt: string;
  observedAt: string;
  wallets: ApiWallet[];
  totals: { recognizedPricedSubtotalUsd: string | null; unpricedAssetCount: number; note: string };
  partial: boolean;
  warnings: string[];
};
export type LookupOutcome =
  | { kind: 'ok'; data: ApiSuccess; address: string }
  | {
      kind: 'error';
      message: string;
      retryable: boolean;
      address: string;
      retryAfterSeconds?: number;
    };

const DEC = /^\d+(\.\d+)?$/;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDec = (v: unknown): v is string => isStr(v) && DEC.test(v);
const isDecOrNull = (v: unknown) => v === null || isDec(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

const AAVE_REASONS = ['rate_limited', 'timeout', 'unavailable', 'bad_response'];
function isAaveSection(v: unknown): v is ApiAaveSection {
  if (!isObj(v)) return false;
  if (v.status === 'unavailable')
    return isStr(v.reason) && (AAVE_REASONS as string[]).includes(v.reason);
  if (v.status !== 'ok') return false;
  if (!Array.isArray(v.positions) || v.positions.length > 100) return false;
  for (const p of v.positions) {
    if (!isObj(p)) return false;
    if (!isStr(p.underlyingAsset) || !/^0x[0-9a-fA-F]{40}$/.test(p.underlyingAsset)) return false;
    if (!isStr(p.symbol) || p.symbol.length === 0 || p.symbol.length > 20) return false;
    const dec = p.decimals;
    if (typeof dec !== 'number' || !Number.isInteger(dec) || dec < 0 || dec > 77) return false;
    if (!isDec(p.supplied) || !isDec(p.variableDebt)) return false;
    if (!isDecOrNull(p.suppliedValueUsd) || !isDecOrNull(p.variableDebtValueUsd)) return false;
    for (const k of ['priceSource', 'priceObservedAt', 'reserveNote'] as const) {
      const val = p[k];
      if (val !== null && (!isStr(val) || val.length > 160)) return false;
    }
    if (typeof p.usageAsCollateralEnabled !== 'boolean') return false;
    if (!isStr(p.observedAt) || Number.isNaN(Date.parse(p.observedAt))) return false;
    if (isStr(p.priceObservedAt) && Number.isNaN(Date.parse(p.priceObservedAt))) return false;
  }
  return true;
}

/** Strict runtime check of the whole response. Anything unexpected is rejected, never guessed. */
export function parseApiSuccess(raw: unknown): ApiSuccess | null {
  if (!isObj(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (raw.mode !== 'mock' && raw.mode !== 'live') return null;
  if (typeof raw.simulated !== 'boolean') return null;
  if (raw.mode === 'mock' && raw.simulated !== true) return null;
  if (raw.mode === 'live' && raw.simulated !== false) return null;
  if (!isStr(raw.provider) || !isStr(raw.generatedAt) || !isStr(raw.observedAt)) return null;
  if (!Number.isFinite(Date.parse(raw.generatedAt)) || !Number.isFinite(Date.parse(raw.observedAt)))
    return null;
  if (typeof raw.partial !== 'boolean' || !strArr(raw.warnings)) return null;
  const t = raw.totals;
  if (!isObj(t) || !isDecOrNull(t.recognizedPricedSubtotalUsd)) return null;
  if (!Number.isInteger(t.unpricedAssetCount) || !isStr(t.note)) return null;
  if (!Array.isArray(raw.wallets) || raw.wallets.length < 1 || raw.wallets.length > 5) return null;
  for (const w of raw.wallets) {
    if (!isObj(w) || !isStr(w.address) || typeof w.partial !== 'boolean' || !strArr(w.warnings))
      return null;
    if (w.aave !== undefined && !isAaveSection(w.aave)) return null;
    if (!Array.isArray(w.assets) || w.assets.length > 200) return null;
    for (const a of w.assets) {
      if (!isObj(a) || !isStr(a.assetId) || !isStr(a.symbol) || !Number.isInteger(a.decimals))
        return null;
      if (!isDec(a.amount) || !isDecOrNull(a.price) || !isDecOrNull(a.value)) return null;
      for (const k of ['priceSource', 'priceObservedAt'] as const) {
        const v = a[k];
        if (v !== undefined && v !== null && (!isStr(v) || v.length > 80)) return null;
      }
      if (isStr(a.priceObservedAt) && Number.isNaN(Date.parse(a.priceObservedAt))) return null;
    }
  }
  return raw as unknown as ApiSuccess;
}

const MESSAGES: Record<number, [string, boolean]> = {
  400: ['That address could not be checked. Check it and try again.', false],
  401: ['You need to sign in through Access to use this feature.', false],
  403: ['This request was blocked.', false],
  413: ['That request was too large.', false],
  415: ['That request was not accepted.', false],
  429: ['The data source is busy. Wait a moment and try again. Nothing was substituted.', true],
  502: ['The data source returned an unusable answer. Nothing was substituted.', true],
  503: [
    'This feature is switched off or the data source is unavailable. Nothing was substituted.',
    true,
  ],
  504: ['The data source took too long. Nothing was substituted.', true],
};

export type TrackNetwork = 'ethereum' | 'solana';

/** Retry-After is a minimum wait, not a promise the upstream will recover. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (header && /^\d+$/.test(header.trim())) {
    const seconds = Number(header.trim());
    if (Number.isSafeInteger(seconds) && seconds <= 2 ** 31 - 1) return seconds;
  }
  if (
    header &&
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)
  ) {
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  }
  return 30; // Our API's documented backoff when a proxy omits or corrupts the header.
}

export async function lookupAddress(
  address: string,
  network: TrackNetwork = 'ethereum',
  signal?: AbortSignal,
): Promise<LookupOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    const res = await fetch('/api/v1/portfolio/resolve', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network, addresses: [address], currency: 'USD' }),
      signal: ctl.signal,
    });
    if (res.ok) {
      let data: ApiSuccess | null = null;
      try {
        data = parseApiSuccess(await res.json());
      } catch {
        data = null; // HTML from an Access redirect or a malformed body
      }
      if (
        data &&
        (data.wallets.length !== 1 ||
          (network === 'ethereum'
            ? data.wallets[0]!.address.toLowerCase() !== address.toLowerCase()
            : data.wallets[0]!.address !== address))
      )
        data = null;
      if (!data)
        return {
          kind: 'error',
          message:
            'The answer was not in the expected form (your Access session may have expired; reload and sign in). Nothing was shown.',
          retryable: true,
          address,
        };
      return { kind: 'ok', data, address };
    }
    if (res.status === 503) {
      let code = '';
      try {
        code = String(
          ((await res.json()) as { error?: { code?: string }; code?: string }).error?.code ?? '',
        );
      } catch {
        /* ignore */
      }
      if (code === 'disabled' || code === 'not_configured')
        return {
          kind: 'error',
          message:
            code === 'disabled'
              ? 'The simulated lookup is switched off on this deployment. This is expected, not a fault.'
              : 'The lookup is not configured on this deployment yet.',
          retryable: false,
          address,
        };
    }
    const [message, retryable] = MESSAGES[res.status] ?? [
      'The lookup failed. Nothing was substituted.',
      true,
    ];
    return {
      kind: 'error',
      message,
      retryable,
      address,
      ...(res.status === 429
        ? { retryAfterSeconds: retryAfterSeconds(res.headers.get('retry-after')) }
        : {}),
    };
  } catch {
    return {
      kind: 'error',
      message: 'The lookup service could not be reached. Nothing was substituted.',
      retryable: true,
      address,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export type BulkLookupOutcome =
  | { kind: 'ok'; data: ApiSuccess }
  | { kind: 'error'; message: string; retryable: boolean; retryAfterSeconds?: number };

/**
 * Multi-address variant for the combined view: one resolve call for up to five saved addresses
 * on one network. Same transport, parsing and failure wording as lookupAddress. A successful
 * answer may legitimately omit a requested address; the caller marks that address failed
 * instead of rejecting the whole answer. An answer naming an address that was never requested
 * is rejected as unusable. Address identity is chain-specific (EVM case-insensitive).
 */
export async function lookupAddresses(
  network: TrackNetwork,
  addresses: string[],
  signal?: AbortSignal,
): Promise<BulkLookupOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  const malformed: BulkLookupOutcome = {
    kind: 'error',
    message:
      'The answer was not in the expected form (your Access session may have expired; reload and sign in). Nothing was shown.',
    retryable: true,
  };
  try {
    const res = await fetch('/api/v1/portfolio/resolve', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network, addresses, currency: 'USD' }),
      signal: ctl.signal,
    });
    if (res.ok) {
      let data: ApiSuccess | null = null;
      try {
        data = parseApiSuccess(await res.json());
      } catch {
        data = null; // HTML from an Access redirect or a malformed body
      }
      if (data) {
        const asked = new Set(
          network === 'ethereum' ? addresses.map((a) => a.toLowerCase()) : addresses,
        );
        const allAsked = data.wallets.every((w) =>
          asked.has(network === 'ethereum' ? w.address.toLowerCase() : w.address),
        );
        if (!allAsked || data.wallets.length > addresses.length) data = null;
      }
      return data ? { kind: 'ok', data } : malformed;
    }
    if (res.status === 503) {
      let code = '';
      try {
        code = String(
          ((await res.json()) as { error?: { code?: string }; code?: string }).error?.code ?? '',
        );
      } catch {
        /* ignore */
      }
      if (code === 'disabled' || code === 'not_configured')
        return {
          kind: 'error',
          message:
            code === 'disabled'
              ? 'The lookup is switched off on this deployment. This is expected, not a fault.'
              : 'The lookup is not configured on this deployment yet.',
          retryable: false,
        };
    }
    const [message, retryable] = MESSAGES[res.status] ?? [
      'The lookup failed. Nothing was substituted.',
      true,
    ];
    return {
      kind: 'error',
      message,
      retryable,
      ...(res.status === 429
        ? { retryAfterSeconds: retryAfterSeconds(res.headers.get('retry-after')) }
        : {}),
    };
  } catch {
    return {
      kind: 'error',
      message: 'The lookup service could not be reached. Nothing was substituted.',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export type SessionState =
  | { kind: 'verified'; email: string; expiresAtMs: number }
  | { kind: 'rejected' }
  | { kind: 'none' };
// Same plain-email contract the server enforces (server/portfolio/access.ts).
const SESSION_EMAIL = /^[^\s@<>"'`]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
export function isSessionEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && SESSION_EMAIL.test(v);
}
export const SESSION_TIMEOUT_MS = 8000;
/**
 * Same-origin GET of who Cloudflare Access says this session is. It sends the browser's own
 * same-origin credentials to this app only; nothing is sent to an external identity service and
 * nothing is stored. Aborts after a bounded time and when the caller's signal aborts.
 */
export async function fetchSession(signal?: AbortSignal): Promise<SessionState> {
  if (signal?.aborted) return { kind: 'none' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch('/api/v1/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctl.signal,
    });
    if (r.status === 401) return { kind: 'rejected' };
    if (r.status !== 200) return { kind: 'none' };
    const j: unknown = await r.json();
    if (
      typeof j === 'object' &&
      j !== null &&
      (j as { status?: unknown }).status === 'ok' &&
      (j as { via?: unknown }).via === 'cloudflare-access'
    ) {
      const id = (j as { identity?: { email?: unknown } | null }).identity;
      const exp = Date.parse(String((j as { expiresAt?: unknown }).expiresAt ?? ''));
      // No usable identity without a real future expiry: a missing, malformed or past time is none.
      if (id && isSessionEmail(id.email) && Number.isFinite(exp) && exp > Date.now())
        return { kind: 'verified', email: id.email, expiresAtMs: exp };
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export type DataMode = 'mock' | 'live' | 'unknown';
export type HealthInfo = { mode: DataMode; aave: boolean };
/** One same-origin health read (no address is sent): the deployment's data mode and whether it
 *  reads Aave V3 positions. Unknown health degrades to 'unknown'/false, never a guessed state. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthInfo> {
  try {
    const r = await fetch('/api/v1/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    const j: unknown = r.ok ? await r.json() : null;
    const m = (j as { mode?: unknown } | null)?.mode;
    return {
      mode: m === 'mock' || m === 'live' ? m : 'unknown',
      aave: (j as { aave?: unknown } | null)?.aave === true,
    };
  } catch {
    return { mode: 'unknown', aave: false };
  }
}
/** Which data mode lookups use on this deployment. */
export async function fetchDataMode(signal?: AbortSignal): Promise<DataMode> {
  return (await fetchHealth(signal)).mode;
}

/**
 * The fourth approved browser request: same-origin saved-addresses API (GET/POST/DELETE).
 * Returns the raw Response; all parsing, mapping and error contracts live in
 * accounts-client.ts. Never called without a verified-session UI state.
 */
export async function accountsRequest(
  method: 'GET' | 'POST' | 'DELETE',
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/portfolio/accounts', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// --- Markets overview: the fifth browser request, a same-origin GET to our own read-only API. ---
import type { MarketOverviewResult, PriceObservation, UnpricedInstrument } from '../markets/model';

export type OverviewOutcome =
  | { kind: 'ok'; data: Extract<MarketOverviewResult, { status: 'available' }> }
  | { kind: 'error'; message: string; retryable: boolean };

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isObservation(v: unknown): v is PriceObservation {
  if (!isObj(v)) return false;
  return (
    v.metric === 'overview' &&
    isStr(v.instrument) &&
    v.instrument.length <= 12 &&
    isStr(v.name) &&
    v.name.length <= 60 &&
    (v.kind === 'native-asset' || v.kind === 'tokenized-equity') &&
    (v.issuer === null || (isStr(v.issuer) && v.issuer.length <= 60)) &&
    (v.underlying === null || (isStr(v.underlying) && v.underlying.length <= 12)) &&
    v.chain === 'solana' &&
    isStr(v.mint) &&
    MINT_RE.test(v.mint) &&
    isDec(v.value) &&
    v.value.length <= 24 &&
    v.unit === 'USD' &&
    isStr(v.primaryVenue) &&
    isStr(v.primaryPairAddress) &&
    strArr(v.venues) &&
    v.venues.length <= 12 &&
    Number.isInteger(v.venueCount) &&
    isDec(v.liquidityUsdApprox) &&
    isDecOrNull(v.dispersionPct) &&
    v.source === 'DexScreener' &&
    v.sourceUpdatedAt === null &&
    v.coverage === 'selected-venues' &&
    strArr(v.warnings) &&
    v.warnings.length <= 8
  );
}

/** Strict runtime check of the whole response. Anything unexpected is rejected, never guessed. */
export function parseOverviewSuccess(
  raw: unknown,
): Extract<MarketOverviewResult, { status: 'available' }> | null {
  if (!isObj(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (raw.status !== 'available') return null;
  if (typeof raw.stale !== 'boolean') return null;
  if (raw.source !== 'DexScreener') return null;
  if (!isStr(raw.retrievedAt) || !Number.isFinite(Date.parse(raw.retrievedAt))) return null;
  if (!Number.isInteger(raw.cacheAgeSeconds) || !Number.isInteger(raw.staleAfterSeconds))
    return null;
  if (!Array.isArray(raw.observations) || raw.observations.length > 12) return null;
  if (!raw.observations.every(isObservation)) return null;
  if (!Array.isArray(raw.unpriced) || raw.unpriced.length > 12) return null;
  for (const u of raw.unpriced as unknown[]) {
    if (!isObj(u) || !isStr(u.instrument) || !isStr(u.reason)) return null;
  }
  return raw as unknown as Extract<MarketOverviewResult, { status: 'available' }> & {
    unpriced: UnpricedInstrument[];
  };
}

const OVERVIEW_MESSAGES: Record<number, [string, boolean]> = {
  401: ['You need to sign in through Access to use this feature.', false],
  403: ['This request was blocked.', false],
  502: ['The price source is unavailable. Nothing was substituted.', true],
  503: ['This feature is switched off or not configured yet.', false],
  504: ['The price source took too long. Nothing was substituted.', true],
};

export async function fetchOverview(force: boolean, signal?: AbortSignal): Promise<OverviewOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/markets/overview${force ? '?refresh=1' : ''}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch {
    return { kind: 'error', message: 'The price request could not be sent.', retryable: true };
  }
  if (!res.ok) {
    const [message, retryable] = OVERVIEW_MESSAGES[res.status] ?? [
      'Prices could not be loaded. Nothing was substituted.',
      true,
    ];
    return { kind: 'error', message, retryable };
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return {
      kind: 'error',
      message: 'The price source returned an unusable answer.',
      retryable: true,
    };
  }
  const data = parseOverviewSuccess(raw);
  if (!data)
    return {
      kind: 'error',
      message: 'The price source returned an unusable answer.',
      retryable: true,
    };
  return { kind: 'ok', data };
}

// --- v0.2 preview: the sixth/seventh/eighth approved browser requests. Same-origin only. ---
/**
 * GET /api/v1/portfolio/overview - the caller's own recorded spot-balance
 * history (reviewed read route). Returns the raw Response; parsing and the
 * honest-state contract live in features/portfolio-v2/what-changed.tsx.
 */
export async function overviewHistoryRequest(signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/portfolio/overview', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * POST /api/v1/auth/email/challenge - request a sign-in code. Message
 * signature sign-in only; this is EMAIL code auth, never wallet signing.
 * Returns the raw Response; error mapping lives in features/auth-v2.
 */
export async function authEmailChallenge(email: string, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/auth/email/challenge', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** POST /api/v1/auth/email/verify - redeem a sign-in code for a session cookie. */
export async function authEmailVerify(
  email: string,
  code: string,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/auth/email/verify', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The tenth approved browser request: GET list + POST add on the native
 * address book (watched addresses; reviewed handlers, per-user CRUD rates).
 * Raw Response; parsing/labels live in features/portfolio-v2/address-book.tsx.
 */
export async function addressBookRequest(
  method: 'GET' | 'POST',
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/portfolio/addresses', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Eleventh: POST rename on the native address book. */
export async function addressRenameRequest(
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/portfolio/addresses/rename', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Twelfth: POST remove (soft delete) on the native address book. */
export async function addressRemoveRequest(
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/portfolio/addresses/remove', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Thirteenth approved browser request: GET the native session identity for the
 * app shell (email + freshness), so the header can greet the NATIVE session
 * instead of the Access profile when one is live. Raw Response; mapping lives
 * in features/auth-v2/native-session.ts.
 */
export async function nativeSessionInfoRequest(signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/auth/email/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Fourteenth: POST native logout (ends the caller's own native session). */
export async function nativeLogoutRequest(signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch('/api/v1/auth/email/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Shared transport for the four passkey (WebAuthn) requests. Same-origin POST
 * with a JSON body; the browser ceremony itself happens in
 * features/auth-v2/passkey-client.ts via navigator.credentials - this module
 * only carries the HTTP leg. */
async function passkeyRequest(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Fifteenth: POST passkey registration options (session required server-side). */
export async function passkeyRegisterOptionsRequest(signal?: AbortSignal): Promise<Response> {
  return passkeyRequest('/api/v1/auth/passkey/register/options', {}, signal);
}

/** Sixteenth: POST passkey registration verification with the signed ceremony response. */
export async function passkeyRegisterVerifyRequest(response: unknown, signal?: AbortSignal): Promise<Response> {
  return passkeyRequest('/api/v1/auth/passkey/register/verify', { response }, signal);
}

/** Seventeenth: POST passkey sign-in options (rate-limited server-side). */
export async function passkeyLoginOptionsRequest(signal?: AbortSignal): Promise<Response> {
  return passkeyRequest('/api/v1/auth/passkey/login/options', {}, signal);
}

/** Eighteenth: POST passkey sign-in verification; the server sets the session cookie. */
export async function passkeyLoginVerifyRequest(challengeId: string, response: unknown, signal?: AbortSignal): Promise<Response> {
  return passkeyRequest('/api/v1/auth/passkey/login/verify', { challengeId, response }, signal);
}

/** Shared transport for the observation-consent and sync requests. One fetch
 * site for all three; same-origin, no-store, JSON. */
async function portfolioActionRequest(
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) ctl.abort();
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Sixteenth fetch site: these three all run through portfolioActionRequest. */
/** GET snapshot-consent status for the session user. */
export async function snapshotConsentStatusRequest(signal?: AbortSignal): Promise<Response> {
  return portfolioActionRequest('/api/v1/portfolio/snapshots/consent', 'GET', undefined, signal);
}

/** POST snapshot-consent change: grant or withdraw (withdraw deletes history). */
export async function snapshotConsentChangeRequest(action: 'grant' | 'withdraw', signal?: AbortSignal): Promise<Response> {
  return portfolioActionRequest('/api/v1/portfolio/snapshots/consent', 'POST', { action }, signal);
}

/** POST observation sync: record a live read of the session user's addresses. */
export async function syncRequest(signal?: AbortSignal): Promise<Response> {
  return portfolioActionRequest('/api/v1/portfolio/sync', 'POST', {}, signal);
}
