'use client';
import { useEffect, useState } from 'react';
import {
  addressBookRequest,
  addressRenameRequest,
  addressRemoveRequest,
} from '../portfolio/api-client';

/**
 * Native address book (v0.2): the only actions the signed-in user has on the
 * Overview until holdings load. Terse, action-first (user steering 2026-10-25);
 * every state honest:
 *   401 -> sign-in required; 503 -> feature off on this build;
 *   429 -> rate limited (retryAfter echoed); 403 reauth_required on remove ->
 *   "sign in again to remove" (fresh-session bar, same as wallet linking).
 * Watched addresses carry no ownership proof - one short badge per row, no wall.
 */

type Entry = {
  network: 'ethereum' | 'solana';
  address: string;
  label: string;
  verification: 'watched' | 'verified';
  createdAt: string;
  lastObservedAt: string | null;
};

type Load =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'off' }
  | { kind: 'ok'; addresses: Entry[] }
  | { kind: 'failed'; retryAfter?: number };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export async function statusOf(res: Response): Promise<Load> {
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 503) return { kind: 'off' };
  if (res.status === 429) {
    // The limiter's body field is retryAfterSec (server/portfolio/addresses.ts);
    // it sends no Retry-After header on these routes.
    let retryAfter: number | undefined;
    try {
      const b = await res.clone().json();
      if (typeof b?.retryAfterSec === 'number') retryAfter = b.retryAfterSec;
    } catch { /* body unreadable */ }
    return { kind: 'failed', retryAfter };
  }
  if (!res.ok) return { kind: 'failed' };
  const body = (await res.json()) as { status?: string; addresses?: Entry[] };
  if (body.status !== 'ok' || !Array.isArray(body.addresses)) return { kind: 'failed' };
  return { kind: 'ok', addresses: body.addresses };
}

export function AddressBook() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [network, setNetwork] = useState<'ethereum' | 'solana'>('ethereum');
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = (signal?: AbortSignal) =>
    addressBookRequest('GET', undefined, signal)
      .then(statusOf)
      .then(setLoad)
      .catch(() => setLoad({ kind: 'failed' }));

  useEffect(() => {
    const ctl = new AbortController();
    refresh(ctl.signal);
    return () => ctl.abort();
  }, []);

  const failNote = (res: Response, action: string): Promise<string> =>
    res.status === 403
      ? res.json().then((b) =>
          b?.error === 'reauth_required'
            ? `Sign in again to ${action} - this action needs a fresh sign-in.`
            : `Could not ${action}.`,
        ).catch(() => `Could not ${action}.`)
      : res.status === 429
        ? res.json().then((b) =>
            typeof b?.retryAfterSec === 'number'
              ? `Too many changes just now - retry in about ${b.retryAfterSec}s.`
              : 'Too many changes just now - wait a moment and retry.',
          ).catch(() => 'Too many changes just now - wait a moment and retry.')
        : res.status === 400
          ? res.json().then((b) =>
              b?.error === 'invalid_address'
                ? 'That address does not look valid for the selected network.'
                : b?.error === 'invalid_label'
                  ? 'Label is required (letters and numbers, up to 40 characters).'
                  : `Could not ${action}.`,
            ).catch(() => `Could not ${action}.`)
          : Promise.resolve(`Could not ${action}.`);

  const add = async () => {
    if (busy || !address.trim() || !label.trim()) return;
    setBusy(true); setNote(null);
    try {
      const res = await addressBookRequest('POST', { network, address: address.trim(), label: label.trim() });
      if (res.ok) {
        setAddress(''); setLabel('');
        await refresh();
      } else {
        setNote(await failNote(res, 'add this address'));
      }
    } catch {
      setNote('Could not add this address.');
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e: Entry) => {
    const next = window.prompt(`Rename ${short(e.address)}`, e.label);
    if (next === null || next.trim() === '' || next.trim() === e.label) return;
    setBusy(true); setNote(null);
    try {
      const res = await addressRenameRequest({ network: e.network, address: e.address, label: next.trim() });
      if (res.ok) await refresh();
      else setNote(await failNote(res, 'rename this address'));
    } catch {
      setNote('Could not rename this address.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: Entry) => {
    if (!window.confirm(`Remove ${e.label} (${short(e.address)})?`)) return;
    setBusy(true); setNote(null);
    try {
      const res = await addressRemoveRequest({ network: e.network, address: e.address });
      if (res.ok) await refresh();
      else setNote(await failNote(res, 'remove this address'));
    } catch {
      setNote('Could not remove this address.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="accounts">
      {load.kind === 'loading' && <p><em>Loading addresses…</em></p>}
      {load.kind === 'signin' && <p><em>Sign in to manage your addresses.</em></p>}
      {load.kind === 'off' && <p><em>The address book is off on this preview build.</em></p>}
      {load.kind === 'failed' && (
        <p><em>
          Addresses unavailable right now.
          {load.retryAfter ? ` Retry in about ${load.retryAfter}s.` : ''}
        </em></p>
      )}

      {load.kind === 'ok' && (
        <>
          {load.addresses.length === 0 ? (
            <p><em>No addresses yet - add one to watch its balances.</em></p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Label</th><th>Network</th><th>Address</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {load.addresses.map((e) => (
                  <tr key={`${e.network}:${e.address}`}>
                    <td>{e.label}</td>
                    <td>{e.network === 'ethereum' ? 'EVM' : 'Solana'}</td>
                    <td><code>{short(e.address)}</code></td>
                    <td>{e.verification === 'verified' ? 'Verified' : 'Watched (no ownership proof)'}</td>
                    <td>
                      <button type="button" onClick={() => rename(e)} disabled={busy}>Rename</button>{' '}
                      <button type="button" onClick={() => remove(e)} disabled={busy}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {load.kind === 'ok' && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <select
            value={network}
            onChange={(ev) => setNetwork(ev.target.value as 'ethereum' | 'solana')}
            disabled={busy}
            aria-label="Network"
          >
            <option value="ethereum">EVM</option>
            <option value="solana">Solana</option>
          </select>
          <input
            type="text"
            placeholder="Address"
            value={address}
            onChange={(ev) => setAddress(ev.target.value)}
            disabled={busy}
            aria-label="Address"
          />
          <input
            type="text"
            placeholder="Label"
            value={label}
            onChange={(ev) => setLabel(ev.target.value)}
            maxLength={40}
            disabled={busy}
            aria-label="Label"
          />
          <button type="submit" disabled={busy || !address.trim() || !label.trim()}>
            Add address
          </button>
        </form>
      )}

      {note && <p role="alert"><em>{note}</em></p>}
    </div>
  );
}
