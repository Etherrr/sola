'use client';
import { useEffect, useState } from 'react';
import { fetchOverview, type NetworkSlice, type ObservedAmount } from './overview-history';
import { diffNetwork, isZero, keyOf } from './network-diff';
import { SYNCED_EVENT } from './snapshot-consent';

/**
 * "What changed" section of the v0.2 Overview: the first UI consuming the
 * wired read route GET /api/v1/portfolio/overview. Every state is honest:
 * 401 -> sign-in staged (native auth is being enabled), 503 -> feature off,
 * empty -> "History begins after your first recorded observation", ok ->
 * latest vs prior COMPLETE-run deltas, spot-balances-only scope labeled.
 */

type Load =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'notinvited' }
  | { kind: 'off' }
  | { kind: 'empty' }
  | { kind: 'ok'; at: string; newerPartial: boolean; latest: ObservedAmount[]; prior: ObservedAmount[] | null; networks: NetworkSlice[] }
  | { kind: 'failed' };

const assetLabel = (assetId: string) => assetId.split('/').pop() ?? assetId;
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function WhatChanged() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const bump = () => setRound((n) => n + 1);
    window.addEventListener(SYNCED_EVENT, bump);
    return () => window.removeEventListener(SYNCED_EVENT, bump);
  }, []);
  useEffect(() => {
    let live = true;
    fetchOverview().then((r) => {
      if (!live) return;
      if (r.kind === 'empty') setLoad({ kind: 'empty' });
      else if (r.kind === 'ok')
        setLoad({ kind: 'ok', at: r.at, newerPartial: r.newerPartial, latest: r.latest, prior: r.prior, networks: r.networks });
      else setLoad({ kind: r.kind });
    });
    return () => { live = false; };
  }, [round]);

  if (load.kind === 'loading') return <p><em>Loading recorded history…</em></p>;
  if (load.kind === 'signin')
    return (
      <p><em>Sign in to load your recorded history.</em></p>
    );
  if (load.kind === 'notinvited')
    return (
      <p><em>This preview is invite-only - this email is not on the list.</em></p>
    );
  if (load.kind === 'off')
    return <p><em>Recorded history is switched off on this deployment.</em></p>;
  if (load.kind === 'failed')
    return <p><em>Recorded history is unavailable right now. Try again later.</em></p>;
  if (load.kind === 'empty')
    return (
      <p>
        <em>History begins after your first recorded observation.</em> Deltas compare the latest
        complete observation against the prior complete one; an incomplete observation is never
        treated as &quot;zero&quot;.
      </p>
    );

  const { newerPartial, networks } = load;
  // Per-network sections: each network's deltas use ONLY its own latest/prior
  // complete observations (reviewer MEDIUM - no cross-network comparison).
  // Absent-in-latest is stated explicitly as "not in latest observation",
  // never silently dropped and never read as zero.
  // No merged fallback: sections come only from real per-network slices
  // (reviewer requirement - a fabricated ethereum section would lie).
  const sections: NetworkSlice[] = networks;
  return (
    <div>
      {newerPartial && (
        <p>
          <em>A newer partial observation exists but is not a trustworthy baseline.</em>
        </p>
      )}
      {sections.map((sec) => {
        const { rows, removed } = diffNetwork(sec);
        return (
          <section key={sec.network} className="ov2-net">
            <p className="ov2-net-label">
              {sec.network === 'solana' ? 'Solana (SOL balance only)' : 'Ethereum'}
            </p>
            <p className="ov2-net-time">Latest complete observation: {sec.at}. Spot balances only.</p>
            {sec.prior === null && (
              <p>First recorded observation - there is no earlier complete observation to compare yet.</p>
            )}
            {rows.length === 0 && removed.length === 0 && sec.prior !== null && (
              <p>No change since the prior complete observation.</p>
            )}
            {rows.length > 0 && (
              <ul>
                {rows.map(({ o, prev, delta }) => (
                  <li key={keyOf(o)}>
                    {assetLabel(o.assetId)} ({short(o.address)}): {o.amount}
                    {prev === undefined ? ' - first seen' : ` (was ${prev}, ${isZero(delta) ? 'no change' : `${delta.startsWith('-') ? '' : '+'}${delta}`})`}
                  </li>
                ))}
              </ul>
            )}
            {removed.length > 0 && (
              <ul>
                {removed.map((o) => (
                  <li key={`removed-${keyOf(o)}`}>
                    {assetLabel(o.assetId)} ({short(o.address)}): not in latest observation (was {o.amount})
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
