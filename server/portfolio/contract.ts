import { checkEvmAddress, checkSolanaAddress } from './address';

export const MAX_ADDRESSES = 5;
export const MAX_BODY_BYTES = 2048;

export type Network = 'ethereum' | 'solana';
export type ResolveRequest = { network: Network; addresses: string[]; currency: 'USD' };

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

/** One Aave V3 reserve position for a wallet: supplied and variable-debt balances only. */
export type AavePositionView = {
  underlyingAsset: string;
  symbol: string;
  decimals: number;
  /** Normalized decimal strings; a '0' side is a true zero, never a failed read. */
  supplied: string;
  variableDebt: string;
  /** USD values exist only when the app's own verified Chainlink feeds priced this asset. */
  suppliedValueUsd: string | null;
  variableDebtValueUsd: string | null;
  priceSource: string | null;
  priceObservedAt: string | null;
  /** The reserve's stored-index observation time (its lastUpdateTimestamp), ISO-8601 UTC. */
  observedAt: string;
  usageAsCollateralEnabled: boolean;
  /** Static note when the reserve is not active, frozen or paused; null otherwise. */
  reserveNote: string | null;
};

/** The Aave V3 section of one wallet's result. Absent entirely when the feature is off or the
 *  network is not Ethereum; a failure is an honest unavailable state, never an empty list. */
export type AaveSection =
  | { status: 'ok'; positions: AavePositionView[] }
  | { status: 'unavailable'; reason: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response' };

export type WalletResult = {
  address: string;
  assets: Asset[];
  partial: boolean;
  warnings: string[];
  aave?: AaveSection;
};

export type ResolveResponse = {
  schemaVersion: 1;
  requestId: string;
  generatedAt: string;
  observedAt: string;
  provider: string;
  chainId: number | null; // 1 for Ethereum mainnet; null where the EVM chain-id concept does not apply (Solana).
  network: Network;
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
  if (o.network !== 'ethereum' && o.network !== 'solana')
    return {
      ok: false,
      status: 400,
      code: 'unsupported_network',
      message: 'Only "ethereum" and "solana" are supported.',
    };
  const network: Network = o.network;
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
    if (network === 'ethereum') {
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
    } else {
      const c = checkSolanaAddress(a);
      if (!c.ok)
        return {
          ok: false,
          status: 400,
          code: 'bad_address',
          message: 'An address is not a valid Solana address.',
        };
      if (!seen.has(c.address)) {
        seen.add(c.address);
        out.push(c.address);
      }
    }
  }
  return { ok: true, value: { network, addresses: out, currency: 'USD' } };
}
