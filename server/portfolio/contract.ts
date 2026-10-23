import { checkEvmAddress } from './address';

export const MAX_ADDRESSES = 5;
export const MAX_BODY_BYTES = 2048;

export type ResolveRequest = { network: 'ethereum'; addresses: string[]; currency: 'USD' };

export type Asset = {
  assetId: string; // chain-qualified: eip155:1/native or eip155:1/erc20:0x...
  symbol: string;
  decimals: number;
  rawAmount: string; // integer units
  amount: string; // normalized decimal
  price: string | null;
  value: string | null;
  priceSource: string | null;
  priceObservedAt: string | null;
};

export type WalletResult = {
  address: string;
  assets: Asset[];
  partial: boolean;
  warnings: string[];
};

export type ResolveResponse = {
  schemaVersion: 1;
  requestId: string;
  generatedAt: string;
  observedAt: string;
  provider: string;
  chainId: 1;
  mode: 'mock' | 'live';
  simulated: boolean;
  wallets: WalletResult[];
  totals: { recognizedPricedSubtotalUsd: string | null; unpricedAssetCount: number; note: string };
  partial: boolean;
  warnings: string[];
};

export type ValidationError = { status: 400 | 413; code: string; message: string };

export function parseResolveRequest(
  bodyText: string,
): { ok: true; value: ResolveRequest } | ({ ok: false } & ValidationError) {
  if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES)
    return {
      ok: false,
      status: 413,
      code: 'body_too_large',
      message: 'Request body is too large.',
    };
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return { ok: false, status: 400, code: 'bad_json', message: 'Request body must be JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, status: 400, code: 'bad_shape', message: 'Request must be an object.' };
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !['network', 'addresses', 'currency'].includes(k));
  if (extra.length)
    return {
      ok: false,
      status: 400,
      code: 'unknown_field',
      message: 'Unexpected field in request.',
    };
  if (o.network !== 'ethereum')
    return {
      ok: false,
      status: 400,
      code: 'unsupported_network',
      message: 'Only "ethereum" is supported.',
    };
  if (o.currency !== 'USD')
    return {
      ok: false,
      status: 400,
      code: 'unsupported_currency',
      message: 'Only "USD" is supported.',
    };
  if (!Array.isArray(o.addresses) || o.addresses.length === 0)
    return { ok: false, status: 400, code: 'bad_addresses', message: 'Provide 1 to 5 addresses.' };
  if (o.addresses.length > MAX_ADDRESSES)
    return { ok: false, status: 400, code: 'too_many_addresses', message: 'At most 5 addresses.' };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of o.addresses) {
    const c = checkEvmAddress(a);
    if (!c.ok)
      return {
        ok: false,
        status: 400,
        code: c.reason === 'checksum' ? 'bad_checksum' : 'bad_address',
        message:
          c.reason === 'checksum'
            ? 'An address has an invalid checksum.'
            : 'An address is not a valid Ethereum address.',
      };
    if (!seen.has(c.address)) {
      seen.add(c.address);
      out.push(c.address);
    }
  }
  return { ok: true, value: { network: 'ethereum', addresses: out, currency: 'USD' } };
}
