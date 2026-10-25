'use client';
import { useEffect, useState } from 'react';
import { fetchOverview, type NetworkSlice, type ObservedAmount } from './overview-history';

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

export function HoldingsTable() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    fetchOverview().then((r) => {
      if (!live) return;
      if (r.kind === 'empty') setLoad({ kind: 'empty', newerPartial: r.newerPartial });
      else if (r.kind === 'ok')
        setLoad({ kind: 'ok', at: r.at, newerPartial: r.newerPartial, rows: r.latest, networks: r.networks });
      else setLoad({ kind: r.kind });
    });
    return () => {
      live = false;
    };
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
              <td>{r.assetId}</td>
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
            {new Date(n.at).toLocaleString()}.
          </span>
        ))}
        {load.newerPartial ? ' A newer observation is still partial.' : ''}
      </em></p>
    </>
  );
}
