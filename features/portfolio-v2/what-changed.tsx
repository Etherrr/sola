'use client';
import { useEffect, useState } from 'react';
import { overviewHistoryRequest } from '../portfolio/api-client';

/**
 * "What changed" section of the v0.2 Overview: the first UI consuming the
 * wired read route GET /api/v1/portfolio/overview. Every state is honest:
 * 401 -> sign-in staged (native auth is being enabled), 503 -> feature off,
 * empty -> "History begins after your first recorded observation", ok ->
 * latest vs prior COMPLETE-run deltas, spot-balances-only scope labeled.
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
  | { kind: 'empty' }
  | { kind: 'ok'; body: Extract<ApiBody, { status: 'ok' }> }
  | { kind: 'failed' };

// Chain-aware identity key, same rule as the reviewed read model: EVM hex
// compares case-insensitively, Solana base58 is case-sensitive - never
// normalize Solana. Duplicates sum at ONE granularity on both sides.
const keyOf = (o: ObservedAmount) =>
  `${o.network}:${o.network === 'ethereum' ? o.address.toLowerCase() : o.address}:${o.assetId}:${o.kind}`;

const isZero = (s: string) => {
  const m = /^-?(\d+)(?:\.(\d+))?$/.exec(s);
  return m !== null && BigInt((m[1] + (m[2] ?? '')).replace(/^0+(?=\d)/, '') || '0') === 0n;
};
const subDec = (a: string, b: string): string => {
  const parse = (s: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s)!;
    return { neg: m[1] === '-', int: m[1] + m[2], frac: m[3] ?? '' };
  };
  const pa = parse(a), pb = parse(b);
  const w = Math.max(pa.frac.length, pb.frac.length);
  const toBig = (p: typeof pa) => {
    const digits = (p.int + p.frac.padEnd(w, '0')).replace(/^0+(?=\d)/, '');
    return BigInt(digits) * (p.neg ? -1n : 1n);
  };
  const d = toBig(pa) - toBig(pb);
  const neg = d < 0n;
  const abs = (neg ? -d : d).toString().padStart(w + 1, '0');
  const int = w ? abs.slice(0, -w) : abs;
  const frac = w ? abs.slice(-w).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
};
const assetLabel = (assetId: string) => assetId.split('/').pop() ?? assetId;
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function WhatChanged() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    overviewHistoryRequest()
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as ApiBody | null;
        if (!live) return;
        if (r.status === 401 || r.status === 403) return setLoad({ kind: 'signin' });
        if (r.status === 503) return setLoad({ kind: 'off' });
        if (!r.ok || !body || !('status' in body)) return setLoad({ kind: 'failed' });
        setLoad(body.status === 'empty' ? { kind: 'empty' } : { kind: 'ok', body });
      })
      .catch(() => live && setLoad({ kind: 'failed' }));
    return () => { live = false; };
  }, []);

  if (load.kind === 'loading') return <p><em>Loading recorded history…</em></p>;
  if (load.kind === 'signin')
    return (
      <p><em>Sign in to load your recorded history.</em></p>
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

  const { latestCompleteObservedAt, newerPartial, latest, prior } = load.body;
  const priorByKey = new Map<string, string>();
  if (prior) for (const o of prior) priorByKey.set(keyOf(o), o.amount);
  const rows = latest
    .map((o) => {
      const prev = priorByKey.get(keyOf(o));
      const delta = prev === undefined ? o.amount : subDec(o.amount, prev);
      return { o, prev, delta };
    })
    .filter((r) => r.prev === undefined || !isZero(r.delta));
  return (
    <div>
      <p>
        <em>
          Latest complete observation: {latestCompleteObservedAt}. Spot balances only
          {newerPartial
            ? ' - a newer partial observation exists but is not a trustworthy baseline.'
            : '.'}
        </em>
      </p>
      {prior === null && (
        <p>First recorded observation - there is no earlier complete observation to compare yet.</p>
      )}
      {rows.length === 0 && prior !== null && <p>No change since the prior complete observation.</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map(({ o, prev, delta }) => (
            <li key={keyOf(o)}>
              {assetLabel(o.assetId)} ({o.network}, {short(o.address)}): {o.amount}
              {prev === undefined ? ' - first seen' : ` (was ${prev}, ${isZero(delta) ? 'no change' : `${delta.startsWith('-') ? '' : '+'}${delta}`})`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
