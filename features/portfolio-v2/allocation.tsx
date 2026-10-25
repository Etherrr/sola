'use client';
import { Donut } from '../portfolio/donut';
import { assetAllocation, money, networkAllocation, symbolColor } from '../portfolio/model';
import { useNativeSession } from '@/features/auth-v2/native-session';
import { useCombined } from './combined-context';

/**
 * At-a-glance allocation for the v0.2 Overview (plan: by chain and holding,
 * a coverage indicator, one Manage addresses action). Derives from the SAME
 * combined read as the "All saved addresses" block - no second request, so no
 * new disclosure surface. Gross priced holdings only: debt and unpriced
 * exposure are excluded, and unknown is never zero.
 */
export function AllocationV2() {
  const native = useNativeSession();
  const { phase } = useCombined();

  if (native.kind === 'loading') {
    return (
      <div className="ov2-allocation">
        <p className="ov2-quiet" role="status">Verifying your sign-in…</p>
      </div>
    );
  }
  if (native.kind === 'none') {
    return (
      <div className="ov2-allocation">
        <p className="ov2-quiet">Sign in to see allocation.</p>
      </div>
    );
  }
  if (phase.kind === 'loading') {
    return (
      <div className="ov2-allocation">
        <p className="ov2-quiet" role="status">Breaking down the combined read…</p>
      </div>
    );
  }
  if (phase.kind !== 'ready') {
    return (
      <div className="ov2-allocation">
        <p className="ov2-quiet">
          Load combined balances above - the same read fills this breakdown. No extra request.
        </p>
      </div>
    );
  }

  const loadedCount = phase.result.perAddress.filter(
    (a) => a.status === 'ok' || a.status === 'partial',
  ).length;
  const partialCount = phase.result.perAddress.filter((a) => a.status === 'partial').length;
  const unpriced = phase.result.perAddress.reduce((n, a) => n + a.unpricedAssets, 0);
  const failed = phase.result.perAddress.filter((a) => a.status === 'failed').length;
  const hasSolana = phase.result.perAddress.some((a) => a.network === 'solana');
  const chains = networkAllocation(phase.result.positions).map((c) => ({
    ...c,
    color: symbolColor(c.network === 'Ethereum' ? 'ETH' : 'SOL'),
  }));
  const rows = assetAllocation(phase.result.positions);

  if (chains.length === 0) {
    return (
      <div className="ov2-allocation">
        <p className="ov2-quiet">
          Nothing priced in the combined read - {loadedCount} of {phase.totalSaved}{' '}
          {phase.totalSaved === 1 ? 'address' : 'addresses'} loaded. Unknown is never zero.
        </p>
      </div>
    );
  }

  return (
    <div className="ov2-allocation">
      <p className="ov2-quiet">Share of gross priced holdings, by chain:</p>
      <div className="alloc-wrap">
        <Donut
          slices={chains.map((c) => ({ label: c.network, percent: c.percent, color: c.color }))}
          caption={chains.length === 1 ? '' : 'by chain'}
          center={chains.length === 1 ? '1 chain' : undefined}
        />
        <ul className="alloc-list">
          {rows.map((r) => (
            <li key={r.assetId}>
              <i style={{ background: symbolColor(r.symbol) }} aria-hidden="true" />
              <span className="alloc-sym">{r.symbol}</span>
              <span className="alloc-val">{money(r.value)}</span>
              <span className="alloc-pct">{r.percent}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="ov2-quiet">
        Coverage: {loadedCount} of {phase.totalSaved}{' '}
        {phase.totalSaved === 1 ? 'address' : 'addresses'} loaded
        {partialCount > 0
          ? ` (${partialCount} partial - some sources did not answer)`
          : ''}
        {failed > 0 ? ` · ${failed} failed` : ''}
        {unpriced > 0
          ? ` · ${unpriced} unpriced ${unpriced === 1 ? 'asset' : 'assets'} unknown`
          : ''}
        . Percentages are of gross priced holdings only - debt and unpriced are excluded,
        never zero.
        {hasSolana ? ' Solana lookups show the SOL balance only.' : ''}
      </p>
      <p className="actions">
        <a className="button secondary" href="#ov2-addresses">
          Manage addresses
        </a>
      </p>
    </div>
  );
}
