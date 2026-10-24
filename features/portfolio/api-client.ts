// The only browser code allowed to make a network request: a same-origin POST to our own
// read-only API. Public addresses only. Never calls a data provider directly.
export type ApiAsset = {
  assetId: string;
  symbol: string;
  decimals: number;
  amount: string;
  price: string | null;
  value: string | null;
};
export type ApiWallet = {
  address: string;
  assets: ApiAsset[];
  partial: boolean;
  warnings: string[];
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
  | { kind: 'error'; message: string; retryable: boolean; address: string };

const DEC = /^\d+(\.\d+)?$/;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDec = (v: unknown) => isStr(v) && DEC.test(v);
const isDecOrNull = (v: unknown) => v === null || isDec(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Strict runtime check of the whole response. Anything unexpected is rejected, never guessed. */
export function parseApiSuccess(raw: unknown): ApiSuccess | null {
  if (!isObj(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (raw.mode !== 'mock' && raw.mode !== 'live') return null;
  if (typeof raw.simulated !== 'boolean') return null;
  if (raw.mode === 'mock' && raw.simulated !== true) return null;
  if (raw.mode === 'live' && raw.simulated !== false) return null;
  if (!isStr(raw.provider) || !isStr(raw.generatedAt) || !isStr(raw.observedAt)) return null;
  if (typeof raw.partial !== 'boolean' || !strArr(raw.warnings)) return null;
  const t = raw.totals;
  if (!isObj(t) || !isDecOrNull(t.recognizedPricedSubtotalUsd)) return null;
  if (!Number.isInteger(t.unpricedAssetCount) || !isStr(t.note)) return null;
  if (!Array.isArray(raw.wallets) || raw.wallets.length < 1 || raw.wallets.length > 5) return null;
  for (const w of raw.wallets) {
    if (!isObj(w) || !isStr(w.address) || typeof w.partial !== 'boolean' || !strArr(w.warnings))
      return null;
    if (!Array.isArray(w.assets) || w.assets.length > 200) return null;
    for (const a of w.assets) {
      if (!isObj(a) || !isStr(a.assetId) || !isStr(a.symbol) || !Number.isInteger(a.decimals))
        return null;
      if (!isDec(a.amount) || !isDecOrNull(a.price) || !isDecOrNull(a.value)) return null;
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

export async function lookupAddress(address: string): Promise<LookupOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch('/api/v1/portfolio/resolve', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network: 'ethereum', addresses: [address], currency: 'USD' }),
      signal: ctl.signal,
    });
    if (res.ok) {
      let data: ApiSuccess | null = null;
      try {
        data = parseApiSuccess(await res.json());
      } catch {
        data = null; // HTML from an Access redirect or a malformed body
      }
      if (data && data.wallets[0]!.address.toLowerCase() !== address.toLowerCase()) data = null;
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
    return { kind: 'error', message, retryable, address };
  } catch {
    return {
      kind: 'error',
      message: 'The lookup service could not be reached. Nothing was substituted.',
      retryable: true,
      address,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type SessionState =
  { kind: 'verified'; email: string } | { kind: 'rejected' } | { kind: 'none' };
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
      if (id && isSessionEmail(id.email)) return { kind: 'verified', email: id.email };
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
