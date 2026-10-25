'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './session-context';
import { useTrackNetwork } from './track-network-context';
import {
  ACCOUNTS_MAX_PER_NETWORK,
  addAccount,
  clearAccounts,
  listAccounts,
  removeAccount,
  validateEntry,
  type AccountsFailure,
  type SavedAccount,
} from './accounts-client';

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; accounts: SavedAccount[]; maxPerNetwork: number }
  | { kind: 'failed'; failure: AccountsFailure };

// Time reads live at module scope: the render-purity rule owns component bodies only.
const nowMs = () => Date.now();

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const day = (iso: string) => iso.slice(0, 10);

/** The failure line under the panel. 429 carries a manual countdown; there is no auto retry. */
function failureText(f: AccountsFailure, maxPerNetwork: number): string {
  switch (f.kind) {
    case 'signin':
      return 'Your sign-in could not be verified. Sign in again to change saved addresses.';
    case 'off':
      return 'Saved addresses are switched off on this deployment. Nothing is stored.';
    case 'storage':
      return 'Account storage is unavailable. Try again later.';
    case 'cap':
      return `At most ${maxPerNetwork} saved addresses per network.`;
    case 'badEntry':
      return f.message;
    case 'limited':
      return 'Too many changes.';
    case 'error':
      return f.message;
  }
}

export function AccountsPanel() {
  const session = useSession();
  const { network, prefillAddress } = useTrackNetwork();
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [failure, setFailure] = useState<AccountsFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);
  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  // Add form
  const [addr, setAddr] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // Inline rename
  const [renaming, setRenaming] = useState<string | null>(null); // address being renamed
  const [renameTo, setRenameTo] = useState('');
  // Confirmations
  const [removing, setRemoving] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const email = session.kind === 'verified' ? session.email : null;
  // In-flight guard: a mutation started under one identity must not apply its result after the
  // identity expired or changed. The identity effect reloads for the new identity anyway.
  const emailRef = useRef(email);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    emailRef.current = email;
  }, [email]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const atEmail = emailRef.current;
      setLoad({ kind: 'loading' });
      const r = await listAccounts(signal);
      if (signal?.aborted || emailRef.current !== atEmail) return;
      if (r.kind === 'ok') setLoad({ kind: 'ready', accounts: r.accounts, maxPerNetwork: r.maxPerNetwork });
      else setLoad({ kind: 'failed', failure: r });
    },
    [],
  );

  // Identity change or expiry: drop every trace of the previous identity BEFORE any fresh data
  // is shown. This is the render-time adjust pattern (no effect), so the stale list never paints.
  const [prevEmail, setPrevEmail] = useState(email);
  if (prevEmail !== email) {
    setPrevEmail(email);
    setLoad(email ? { kind: 'loading' } : { kind: 'idle' });
    setFailure(null);
    setRenaming(null);
    setRemoving(null);
    setClearing(false);
  }
  // Load on verified identity. Only the fetch lives in the effect; state moves in its callback.
  useEffect(() => {
    if (!email) return;
    let stale = false;
    const ctl = new AbortController();
    void listAccounts(ctl.signal).then((r) => {
      if (stale) return;
      if (r.kind === 'ok') setLoad({ kind: 'ready', accounts: r.accounts, maxPerNetwork: r.maxPerNetwork });
      else setLoad({ kind: 'failed', failure: r });
    });
    return () => {
      stale = true;
      ctl.abort();
    };
  }, [email]);

  // Display clock for the manual 429 countdown only; nothing retries by itself.
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => setNow(nowMs());
    tick();
    const t = window.setInterval(() => {
      tick();
      if (nowMs() >= retryAt) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [retryAt]);

  function fail(f: AccountsFailure) {
    setFailure(f);
    if (f.kind === 'limited') {
      const at = nowMs() + f.retryAfterSeconds * 1000;
      setNow(nowMs());
      setRetryAt(at);
    }
  }

  async function onAdd() {
    if (busy || nowMs() < retryAt) return;
    const v = validateEntry(network, addr, label);
    if ('error' in v) {
      setFormError(v.error);
      return;
    }
    setFormError(null);
    setFailure(null);
    setBusy(true);
    const atEmail = emailRef.current;
    const r = await addAccount(network, v.address, v.label);
    setBusy(false);
    if (emailRef.current !== atEmail) return;
    if (r.kind === 'ok') {
      setAddr('');
      setLabel('');
      await refresh();
    } else fail(r);
  }

  async function onRename(address: string) {
    if (busy || nowMs() < retryAt) return;
    const acct = load.kind === 'ready' ? load.accounts.find((a) => a.address === address) : null;
    if (!acct) return;
    const v = validateEntry(acct.network, address, renameTo);
    if ('error' in v) {
      setFormError(v.error);
      return;
    }
    setFormError(null);
    setBusy(true);
    const atEmail = emailRef.current;
    const r = await addAccount(acct.network, address, v.label); // same key: relabels
    setBusy(false);
    if (emailRef.current !== atEmail) return;
    if (r.kind === 'ok') {
      setRenaming(null);
      await refresh();
    } else fail(r);
  }

  async function onRemove(acct: SavedAccount) {
    if (busy || nowMs() < retryAt) return;
    setBusy(true);
    const atEmail = emailRef.current;
    const r = await removeAccount(acct.network, acct.address);
    setBusy(false);
    if (emailRef.current !== atEmail) return;
    if (r.kind === 'ok') {
      setRemoving(null);
      await refresh();
      headingRef.current?.focus({ preventScroll: true }); // focus is never lost after a removal
    } else fail(r);
  }

  async function onClear() {
    if (busy || nowMs() < retryAt) return;
    setBusy(true);
    const atEmail = emailRef.current;
    const r = await clearAccounts();
    setBusy(false);
    if (emailRef.current !== atEmail) return;
    if (r.kind === 'ok') {
      setClearing(false);
      await refresh();
      headingRef.current?.focus({ preventScroll: true }); // same after clearing the list
    } else fail(r);
  }

  if (session.kind === 'checking')
    return (
      <section className="accounts" aria-label="Saved addresses">
        <p className="fine">Checking your sign-in…</p>
      </section>
    );
  if (session.kind !== 'verified')
    return (
      <section className="accounts" aria-labelledby="accounts-h">
        <h2 id="accounts-h" tabIndex={-1} ref={headingRef}>Saved addresses</h2>
        <p className="fine">
          Saving addresses needs a verified sign-in. Nothing is saved while you are signed out.
        </p>
      </section>
    );

  const ready = load.kind === 'ready' ? load : null;
  const maxPerNetwork = ready?.maxPerNetwork ?? ACCOUNTS_MAX_PER_NETWORK;
  const byNet = (n: 'ethereum' | 'solana') => ready?.accounts.filter((a) => a.network === n) ?? [];

  return (
    <section className="accounts" aria-labelledby="accounts-h">
      <p className="eyebrow">SAVED ADDRESSES</p>
      <h2 id="accounts-h" tabIndex={-1} ref={headingRef}>Saved addresses</h2>
      <p className="fine">
        Saved under your verified sign-in on this service. A saved address is observed, not proven
        to be yours. Removing an address deletes it from the live saved list right away; the
        storage system's backup feature can restore deleted data for up to 7 days, and no stronger
        erasure is promised.
      </p>

      {load.kind === 'loading' && <p className="fine">Loading saved addresses…</p>}
      {load.kind === 'failed' && (
        <div className="notice" role="alert">
          <p className="fine">{failureText(load.failure, maxPerNetwork)}</p>
          {load.failure.kind === 'storage' || (load.failure.kind === 'error' && load.failure.retryable) ? (
            <div className="actions">
              <button type="button" className="button secondary" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      )}

      {ready && (
        <>
          {(['ethereum', 'solana'] as const).map((n) => (
            <div key={n} className="accounts-group">
              <h3>{n === 'ethereum' ? 'Ethereum' : 'Solana'}</h3>
              {byNet(n).length === 0 ? (
                <p className="fine muted">None saved.</p>
              ) : (
                <ul className="accounts-list" data-sensitive>
                  {byNet(n).map((a) => (
                    <li key={a.address} className="accounts-row">
                      {renaming === a.address ? (
                        <span className="accounts-rename">
                          <input
                            type="text"
                            value={renameTo}
                            maxLength={40}
                            aria-label={`New label for ${a.address}`}
                            onChange={(e) => setRenameTo(e.target.value)}
                          />
                          <button type="button" className="button secondary chip" disabled={busy} onClick={() => void onRename(a.address)}>
                            Save
                          </button>
                          <button type="button" className="button secondary chip" onClick={() => setRenaming(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <>
                          <span className="accounts-id">
                            <strong>{a.label}</strong>{' '}
                            <span className="addr" title={a.address}>{short(a.address)}</span>{' '}
                            <span className="fine muted">saved {day(a.createdAt)}</span>
                          </span>
                          {removing === a.address ? (
                            <span className="actions" role="group" aria-label="Confirm removal">
                              <button type="button" className="button secondary chip" disabled={busy} onClick={() => void onRemove(a)}>
                                Remove it
                              </button>
                              <button type="button" className="button secondary chip" onClick={() => setRemoving(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <span className="actions">
                              <button
                                type="button"
                                className="button secondary chip"
                                onClick={() => prefillAddress(a.address, a.network)}
                              >
                                Use in Track
                              </button>
                              <button
                                type="button"
                                className="button secondary chip"
                                onClick={() => {
                                  setRenaming(a.address);
                                  setRenameTo(a.label);
                                  setFormError(null);
                                }}
                              >
                                Rename
                              </button>
                              <button type="button" className="button secondary chip" onClick={() => setRemoving(a.address)}>
                                Remove
                              </button>
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <form
            className="accounts-add"
            onSubmit={(e) => {
              e.preventDefault();
              void onAdd();
            }}
          >
            <div className="track-input">
              <label htmlFor="accounts-addr">
                Save {network === 'ethereum' ? 'an Ethereum' : 'a Solana'} address
              </label>
              <input
                id="accounts-addr"
                type="text"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder={network === 'ethereum' ? '0x…' : 'Base58 address'}
                autoComplete="off"
                spellCheck={false}
              />
              <label htmlFor="accounts-label">Label</label>
              <input
                id="accounts-label"
                type="text"
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Cold wallet"
                autoComplete="off"
              />
              <p className="fine">The network picker above the lookup form also chooses this network.</p>
            </div>
            {formError && (
              <p role="alert" className="fine">
                {formError}
              </p>
            )}
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy || waiting > 0}>
                {busy ? 'Saving…' : 'Save address'}
              </button>
            </div>
          </form>

          {ready.accounts.length > 0 &&
            (clearing ? (
              <div className="notice">
                <p className="fine">Clear every saved address? This removes only the saved list shown here. It does not sign you out or delete anything else.</p>
                <div className="actions">
                  <button type="button" className="button secondary" disabled={busy} onClick={() => void onClear()}>
                    Clear saved list
                  </button>
                  <button type="button" className="button secondary" onClick={() => setClearing(false)}>
                    Keep my list
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => setClearing(true)}>
                  Clear all saved addresses
                </button>
              </div>
            ))}

          <div role="status" aria-live="polite">
            {failure && (
              <p role="alert" className="fine">
                {failureText(failure, maxPerNetwork)}
                {failure.kind === 'limited' && waiting > 0 ? ` Retry available in ${waiting} seconds. No automatic retry.` : ''}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
