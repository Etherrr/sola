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
  { kind: 'ok'; data: ApiSuccess } | { kind: 'error'; message: string; retryable: boolean };

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
      const data = (await res.json()) as ApiSuccess;
      if (!Array.isArray(data.wallets))
        return { kind: 'error', message: MESSAGES[502]![0], retryable: true };
      return { kind: 'ok', data };
    }
    const [message, retryable] = MESSAGES[res.status] ?? [
      'The lookup failed. Nothing was substituted.',
      true,
    ];
    return { kind: 'error', message, retryable };
  } catch {
    return {
      kind: 'error',
      message: 'The lookup service could not be reached. Nothing was substituted.',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
