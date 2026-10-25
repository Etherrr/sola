// Account-scoped saved address lists. Design: docs/PORTFOLIO_ACCOUNTS_DESIGN.md.
// Owner identity is ALWAYS the verified Access JWT iss+sub from the same verification
// operation; a client-supplied owner is never accepted. Preparation only: no binding,
// migration or production storage is authorized; the D1 adapter is UNTESTED until a
// binding is approved and created.
export type Network = 'ethereum' | 'solana';
export type TrackedAddress = {
  network: Network;
  address: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export const MAX_PER_NETWORK = 5;
export const MAX_LABEL = 40;

const ETH = /^0x[0-9a-fA-F]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ISS = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
// eslint-disable-next-line no-control-regex -- intentional: reject control characters in stored input
const CONTROL = /[\u0000-\u001F\u007F]/;

export function ownerKey(iss: unknown, sub: unknown): string | null {
  if (typeof iss !== 'string' || typeof sub !== 'string') return null;
  if (!ISS.test(iss) || sub.length === 0 || sub.length > 255 || CONTROL.test(sub)) return null;
  return `${iss}#${sub}`;
}

/** Validates and normalizes one entry; returns null when anything is out of bounds. */
export function parseEntry(
  input: unknown,
): { network: Network; address: string; label: string } | null {
  if (!input || typeof input !== 'object') return null;
  const { network, address, label } = input as Record<string, unknown>;
  if (network !== 'ethereum' && network !== 'solana') return null;
  if (typeof address !== 'string' || typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL || CONTROL.test(trimmed)) return null;
  if (network === 'ethereum') {
    if (!ETH.test(address)) return null;
    return { network, address: address.toLowerCase(), label: trimmed };
  }
  if (!SOL.test(address)) return null;
  return { network, address, label: trimmed };
}

/** Store-level normalization: every adapter applies it, so no caller can split identity by case. */
export function normEntry<T extends { network: Network; address: string }>(e: T): T {
  return e.network === 'ethereum' ? { ...e, address: e.address.toLowerCase() } : e;
}

export type StoreResult =
  | { ok: true; entry: TrackedAddress }
  | { ok: false; reason: 'cap' | 'storage' };

export interface AccountsStore {
  list(owner: string): Promise<TrackedAddress[]>;
  add(
    owner: string,
    entry: { network: Network; address: string; label: string },
    now: string,
  ): Promise<StoreResult>;
  remove(owner: string, network: Network, address: string): Promise<void>;
  clear(owner: string): Promise<void>;
}

/** Fully tested in-memory store: same semantics as the D1 adapter, no persistence. */
export function createMemoryStore(): AccountsStore {
  const rows = new Map<string, TrackedAddress>(); // key: owner|network|address
  const k = (o: string, n: Network, a: string) => `${o}|${n}|${a}`;
  return {
    async list(owner) {
      const out: TrackedAddress[] = [];
      for (const [key, row] of rows) if (key.startsWith(`${owner}|`)) out.push({ ...row });
      return out;
    },
    async add(owner, rawEntry, now) {
      const entry = normEntry(rawEntry);
      const key = k(owner, entry.network, entry.address);
      const existing = rows.get(key);
      if (existing) {
        const updated = { ...existing, label: entry.label, updatedAt: now };
        rows.set(key, updated);
        return { ok: true, entry: { ...updated } };
      }
      let count = 0;
      for (const rk of rows.keys()) if (rk.startsWith(`${owner}|${entry.network}|`)) count += 1;
      if (count >= MAX_PER_NETWORK) return { ok: false, reason: 'cap' };
      const row: TrackedAddress = { ...entry, createdAt: now, updatedAt: now };
      rows.set(key, row);
      return { ok: true, entry: { ...row } };
    },
    async remove(owner, network, address) {
      rows.delete(k(owner, network, network === 'ethereum' ? address.toLowerCase() : address));
    },
    async clear(owner) {
      for (const key of [...rows.keys()]) if (key.startsWith(`${owner}|`)) rows.delete(key);
    },
  };
}
