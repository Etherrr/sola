'use client';
import { useEffect, useState } from 'react';
import {
  loadConsent,
  changeConsent,
  runSync,
  type ConsentState,
} from './snapshot-sync';
import { invalidateOverview } from './overview-history';

/**
 * Balance-history recording: explicit opt-in, honest cadence (records when
 * you Refresh), withdraw deletes the recorded history (confirmed first,
 * naming the consequence - reviewer requirement). Terse, action-first; no
 * explanation walls (user steering 2026-10-25).
 */

export const SYNCED_EVENT = 'sola:observation-synced';

export function SnapshotConsent() {
  const [state, setState] = useState<ConsentState>({ kind: 'failed' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadConsent().then((s) => {
      if (!live) return;
      setState(s);
      setLoaded(true);
    });
    return () => { live = false; };
  }, []);

  const act = async (fn: () => Promise<ConsentState>) => {
    setBusy(true); setNote(null);
    const s = await fn();
    setState(s);
    if (s.kind === 'failed') setNote('That did not go through. Try again.');
    setBusy(false);
  };

  const withdraw = async () => {
    // The consequence is named before anything is deleted.
    if (!window.confirm('Stop recording and permanently delete your recorded balance history?'))
      return;
    await act(() => changeConsent('withdraw'));
    invalidateOverview();
    window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: { reason: 'withdraw' } }));
  };

  const refresh = async () => {
    setBusy(true); setNote(null);
    const out = await runSync();
    switch (out.kind) {
      case 'ok':
        setNote(out.recorded
          ? out.notes.length > 0
            ? `Recorded. ${out.notes.join('; ')}.`
            : 'Recorded.'
          : out.notes.length > 0
            ? out.notes.join('; ') + '.'
            : 'Nothing new to record.');
        if (out.recorded) {
          invalidateOverview();
          window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: { reason: 'recorded' } }));
        }
        break;
      case 'no_consent': setNote('Recording is off - turn it on first.'); break;
      case 'no_addresses': setNote('Add an address first.'); break;
      case 'limited': setNote(`Too many refreshes. Try again in about ${out.retryAfterSec} seconds.`); break;
      case 'signin': setNote('Sign in to refresh.'); break;
      case 'notinvited': setNote('This preview is invite-only - this email is not on the list.'); break;
      case 'off': setNote('Live chain reads are switched off on this deployment.'); break;
      default: setNote('Refresh failed. Try again.');
    }
    setBusy(false);
  };

  if (!loaded) return <p><em>Loading recording state…</em></p>;
  if (state.kind === 'signin') return null; // the page already stages sign-in
  if (state.kind === 'notinvited') return null;
  if (state.kind === 'off') return <p><em>Balance history recording is off on this deployment.</em></p>;
  if (state.kind === 'failed') return <p><em>Recording state unavailable right now.</em></p>;

  return (
    <div className="accounts">
      {state.consented ? (
        <>
          <p>
            <em>Balance history: recording on. Records when you refresh. Stored under your account, kept until you delete it.</em>
          </p>
          <p className="actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Working…' : 'Refresh'}
            </button>{' '}
            <button type="button" className="button secondary" disabled={busy} onClick={() => void withdraw()}>
              Stop &amp; delete history
            </button>
          </p>
        </>
      ) : (
        <>
          <p>
            <em>Balance history: off. Records your balances when you refresh. Stored under your account, kept until you delete it. Withdraw anytime - recorded history is deleted.</em>
          </p>
          <p className="actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void act(() => changeConsent('grant'))}
            >
              {busy ? 'Working…' : 'Turn on recording'}
            </button>
          </p>
        </>
      )}
      <p>
        <em>Refresh reads your saved addresses through public chain nodes.</em>
      </p>
      {note && <p role="alert" className="form-alert">{note}</p>}
    </div>
  );
}
