// Browser client for the saved-addresses API. Same-origin only, verified-session only; it never
// talks to any external service. Mirrors the server's validation only to spare a round trip -
// the server stays the authority. Nothing here persists anything itself.
import { accountsRequest, retryAfterSeconds } from './api-client';

export type SavedAccount = {
  network: 'ethereum' | 'solana';
  address: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

/** Kept in step with server/accounts/store.ts (MAX_LABEL, MAX_PER_NETWORK, parseEntry). */
export const ACCOUNTS_MAX_LABEL = 40;
export const ACCOUNTS_MAX_PER_NETWORK = 5;
const ETH = /^0x[0-9a-fA-F]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// eslint-disable-next-line no-control-regex -- intentional: reject control characters in stored input
const CONTROL = /[\u0000-\u001F\u007F]/;

/** Client-side pre-check with the same rules as the server; null means "send it". */
export function validateEntry(
  network: 'ethereum' | 'solana',
  address: string,
  label: string,
): { address: string; label: string } | { error: string } {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > ACCOUNTS_MAX_LABEL || CONTROL.test(trimmed))
    return { error: `A label is 1 to ${ACCOUNTS_MAX_LABEL} characters, no control characters.` };
  if (network === 'ethereum') {
    if (!ETH.test(address))
      return { error: 'Enter an Ethereum address: 0x followed by 40 hexadecimal characters.' };
    return { address: address.toLowerCase(), label: trimmed };
  }
  if (!SOL.test(address))
    return { error: 'Enter a Solana address: 32 to 44 base58 characters (no 0x prefix).' };
  return { address, label: trimmed };
}

export type AccountsFailure =
  | { kind: 'signin' }
  | { kind: 'off' } // feature switched off or not configured on this deployment (default-off)
  | { kind: 'storage' } // storage layer unavailable; retryable by the user
  | { kind: 'cap' }
  | { kind: 'badEntry'; message: string }
  | { kind: 'limited'; retryAfterSeconds: number }
  | { kind: 'error'; message: string; retryable: boolean };

export type ListOutcome = { kind: 'ok'; accounts: SavedAccount[]; maxPerNetwork: number } | AccountsFailure;
export type WriteOutcome = { kind: 'ok'; account?: SavedAccount } | AccountsFailure;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseAccount(v: unknown): SavedAccount | null {
  if (!isObj(v)) return null;
  if (v.network !== 'ethereum' && v.network !== 'solana') return null;
  if (!isStr(v.address) || !isStr(v.label) || !isStr(v.createdAt) || !isStr(v.updatedAt))
    return null;
  if (v.address.length > 44 || v.label.length > ACCOUNTS_MAX_LABEL + 8) return null;
  return { network: v.network, address: v.address, label: v.label, createdAt: v.createdAt, updatedAt: v.updatedAt };
}

/** Reads the bounded {error:{code,message}} contract; anything else is not trusted. */
async function failureFrom(res: Response): Promise<AccountsFailure> {
  let code = '';
  let message = '';
  try {
    const j: unknown = await res.json();
    if (isObj(j) && isObj(j.error)) {
      if (isStr(j.error.code) && j.error.code.length <= 40) code = j.error.code;
      if (isStr(j.error.message) && j.error.message.length <= 200) message = j.error.message;
    }
  } catch {
    // Non-JSON error bodies (Access redirects, proxies) carry no trusted detail.
  }
  switch (res.status) {
    case 401:
      return { kind: 'signin' };
    case 409:
      return { kind: 'cap' };
    case 429:
      return { kind: 'limited', retryAfterSeconds: retryAfterSeconds(res.headers.get('retry-after')) };
    case 400:
      return { kind: 'badEntry', message: message || 'That entry was not accepted.' };
    case 408:
      return { kind: 'error', message: 'That request took too long. Try again.', retryable: true };
    case 413:
    case 415:
      return { kind: 'badEntry', message: 'That request was not accepted.' };
    case 503:
      if (code === 'disabled' || code === 'not_configured') return { kind: 'off' };
      if (code === 'storage_unavailable') return { kind: 'storage' };
      return { kind: 'error', message: 'Saved addresses are unavailable. Try again later.', retryable: true };
    default:
      return {
        kind: 'error',
        message: res.status >= 500 ? 'Saved addresses are unavailable. Try again later.' : 'That request was not accepted.',
        retryable: res.status >= 500,
      };
  }
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  body: unknown,
  signal?: AbortSignal,
): Promise<{ res: Response; json: unknown } | AccountsFailure> {
  let res: Response;
  try {
    res = await accountsRequest(method, body, signal);
  } catch {
    return { kind: 'error', message: 'The request could not be completed. Check your connection.', retryable: true };
  }
  if (!res.ok) return failureFrom(res);
  try {
    return { res, json: await res.json() };
  } catch {
    return { kind: 'error', message: 'Saved addresses returned an unusable answer.', retryable: true };
  }
}

export async function listAccounts(signal?: AbortSignal): Promise<ListOutcome> {
  const r = await call('GET', undefined, signal);
  if (!('json' in r)) return r;
  const j = r.json;
  if (!isObj(j) || !Array.isArray(j.accounts)) return { kind: 'error', message: 'Saved addresses returned an unusable answer.', retryable: true };
  const accounts: SavedAccount[] = [];
  for (const raw of j.accounts) {
    const a = parseAccount(raw);
    if (!a) return { kind: 'error', message: 'Saved addresses returned an unusable answer.', retryable: true };
    accounts.push(a);
  }
  const max = isObj(j.limits) && Number.isInteger(j.limits.maxPerNetwork) ? (j.limits.maxPerNetwork as number) : ACCOUNTS_MAX_PER_NETWORK;
  return { kind: 'ok', accounts, maxPerNetwork: max };
}

export async function addAccount(
  network: 'ethereum' | 'solana',
  address: string,
  label: string,
  signal?: AbortSignal,
): Promise<WriteOutcome> {
  const r = await call('POST', { network, address, label }, signal);
  if (!('json' in r)) return r;
  const a = parseAccount((r.json as { account?: unknown })?.account);
  return a ? { kind: 'ok', account: a } : { kind: 'ok' };
}

export async function removeAccount(
  network: 'ethereum' | 'solana',
  address: string,
  signal?: AbortSignal,
): Promise<WriteOutcome> {
  const r = await call('DELETE', { network, address }, signal);
  if (!('json' in r)) return r;
  return { kind: 'ok' };
}

export async function clearAccounts(signal?: AbortSignal): Promise<WriteOutcome> {
  const r = await call('DELETE', { all: true }, signal);
  if (!('json' in r)) return r;
  return { kind: 'ok' };
}
