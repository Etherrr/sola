'use client';
import { useEffect, useRef, useState } from 'react';
import {
  fetchOverview,
  invalidateOverview,
  type NetworkSlice,
  type ObservedAmount,
  type OverviewResult,
} from './overview-history';
import { SYNCED_EVENT } from './snapshot-consent';
import { assetLabel } from './asset-label';
import { fmtTimestamp } from './format-time';

/**
 * v0.2 Holdings table: renders the caller's OWN latest COMPLETE recorded
 * observation from the wired read route GET /api/v1/portfolio/overview -
 * real recorded data, never demo fixtures. Scope stays honest and terse:
 * spot balances only, labeled with the observation time; newerPartial gets
 * the "latest complete observation" wording. Same state mapping as
 * what-changed.tsx (401 sign-in / 503 off / empty / failed).
 */

type Load =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'notinvited' }
  | { kind: 'off' }
  | { kind: 'empty'; newerPartial: boolean }
  | { kind: 'ok'; at: string; newerPartial: boolean; rows: ObservedAmount[]; networks: NetworkSlice[] }
  | { kind: 'failed' };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const toLoad = (r: OverviewResult): Load => {
  if (r.kind === 'empty') return { kind: 'empty', newerPartial: r.newerPartial };
  if (r.kind === 'ok')
    return { kind: 'ok', at: r.at, newerPartial: r.newerPartial, rows: r.latest, networks: r.networks };
  return { kind: r.kind };
};

export function HoldingsTable() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Bumped on every sync event: a pre-event response resolving late is
  // discarded instead of repainting deleted or superseded balances.
  const gen = useRef(0);

  useEffect(() => {
    let live = true;
    const g = gen.current;
    fetchOverview().then((r) => {
      if (live && gen.current === g) setLoad(toLoad(r));
    });
    return () => {
      live = false;
    };
  }, []);

  // Sync/refresh/withdrawal consistency (reviewer requirement, shared with
  // address-book and what-changed): withdrawal clears the panel at once -
  // deleted amounts never stay visible; a recorded refresh keeps the current
  // figures until the fresh ones arrive. The shared in-flight request is
  // dropped so no consumer joins a pre-change response.
  useEffect(() => {
    const onSynced = (e: Event) => {
      gen.current++;
      invalidateOverview();
      if ((e as CustomEvent).detail?.reason === 'withdraw') setLoad({ kind: 'loading' });
      const g = gen.current;
      fetchOverview().then((r) => {
        if (gen.current === g) setLoad(toLoad(r));
      });
    };
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  if (load.kind === 'loading') return <p><em>Loading holdings…</em></p>;
  if (load.kind === 'signin') return <p><em>Sign in to load your recorded holdings.</em></p>;
  if (load.kind === 'notinvited')
    return <p><em>This preview is invite-only - this email is not on the list.</em></p>;
  if (load.kind === 'off') return <p><em>Holdings are off on this preview build.</em></p>;
  if (load.kind === 'failed') return <p><em>Holdings unavailable right now.</em></p>;
  if (load.kind === 'empty')
    return (
      <p><em>
        No recorded balances yet{load.newerPartial ? ' - a newer observation is still partial' : ''}.
        Holdings appear after the first complete observation of your watched addresses.
      </em></p>
    );

  return (
    <>
      <table>
        <thead>
          <tr><th>Asset</th><th>Network</th><th>Amount</th><th>Address</th></tr>
        </thead>
        <tbody>
          {load.rows.map((r) => (
            <tr key={`${r.network}:${r.address}:${r.assetId}:${r.kind}`}>
              <td title={r.assetId}>{assetLabel(r.assetId)}</td>
              <td>{r.network === 'ethereum' ? 'EVM' : 'Solana'}</td>
              <td>{r.amount}</td>
              <td><code>{short(r.address)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><em>
        Spot balances only.
        {load.networks.map((n) => (
          <span key={n.network}>
            {' '}
            {n.network === 'ethereum' ? 'Ethereum' : 'Solana (SOL balance only)'} as of{' '}
            <span title={n.at}>{fmtTimestamp(n.at)}</span>.
          </span>
        ))}
        {load.newerPartial ? ' A newer observation is still partial.' : ''}
      </em></p>
    </>
  );
}
