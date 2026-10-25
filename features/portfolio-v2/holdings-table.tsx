'use client';
import { useEffect, useState } from 'react';
import { overviewHistoryRequest } from '../portfolio/api-client';

/**
 * v0.2 Holdings table: renders the caller's OWN latest COMPLETE recorded
 * observation from the wired read route GET /api/v1/portfolio/overview -
 * real recorded data, never demo fixtures. Scope stays honest and terse:
 * spot balances only, labeled with the observation time; newerPartial gets
 * the "latest complete observation" wording. Same state mapping as
 * what-changed.tsx (401 sign-in / 503 off / empty / failed).
 */

type ObservedAmount = {
  assetId: string;
  network: 'ethereum' | 'solana';
  address: string;
  kind: string;
  amount: string;
  observedAt: string;
};
type ApiBody =
  | { status: 'empty'; reason: string; newerPartial: boolean }
  | { status: 'ok'; scope: string; latestCompleteObservedAt: string; newerPartial: boolean; latest: ObservedAmount[]; prior: ObservedAmount[] | null }
  | { error: string };

type Load =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'off' }
  | { kind: 'empty'; newerPartial: boolean }
  | { kind: 'ok'; at: string; newerPartial: boolean; rows: ObservedAmount[] }
  | { kind: 'failed' };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function HoldingsTable() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const ctl = new AbortController();
    overviewHistoryRequest(ctl.signal)
      .then(async (res): Promise<Load> => {
        if (res.status === 401) return { kind: 'signin' };
        if (res.status === 503) return { kind: 'off' };
        if (!res.ok) return { kind: 'failed' };
        const body = (await res.json()) as ApiBody;
        if ('error' in body) return { kind: 'failed' };
        if (body.status === 'empty') return { kind: 'empty', newerPartial: body.newerPartial };
        return {
          kind: 'ok',
          at: body.latestCompleteObservedAt,
          newerPartial: body.newerPartial,
          rows: body.latest,
        };
      })
      .then(setLoad)
      .catch(() => setLoad({ kind: 'failed' }));
    return () => ctl.abort();
  }, []);

  if (load.kind === 'loading') return <p><em>Loading holdings…</em></p>;
  if (load.kind === 'signin') return <p><em>Sign in to load your recorded holdings.</em></p>;
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
        Spot balances only, from the latest complete observation at{' '}
        {new Date(load.at).toLocaleString()}.
        {load.newerPartial ? ' A newer observation is still partial.' : ''}
      </em></p>
    </>
  );
}
