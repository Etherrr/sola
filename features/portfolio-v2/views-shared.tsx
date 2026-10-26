'use client';
// Shared honest-state blocks for the recorded Assets / DeFi / Risk pages
// (plan 6.2-6.4). Copy stays terse; every unavailable metric is named as
// such, never hidden and never invented.
import Link from 'next/link';
import type { RecordedRunMembership } from './views-client';

export function StateBlock({ kind, reason }: { kind: string; reason?: string }) {
  if (kind === 'signin')
    return (
      <p className="muted">
        Sign in to see your recorded view. <Link href="/dev/sign-in">Sign in</Link>
      </p>
    );
  if (kind === 'notinvited')
    return <p className="muted">This account has no portfolio access yet.</p>;
  if (kind === 'off')
    return <p className="muted">This feature is switched off on this deployment.</p>;
  if (kind === 'empty' && reason === 'no_recorded_observations')
    return (
      <p className="muted">
        No recorded observations yet. This page fills in after the first complete recorded
        observation.
      </p>
    );
  if (kind === 'empty')
    return (
      <p className="muted">
        The latest complete observation recorded no holdings here - an empty wallet is not an
        error.
      </p>
    );
  return <p className="muted">Could not load this view. Try again shortly.</p>;
}

/** Recorded-scope + membership caveats. 'exact' means recorded-run
 *  membership only - no extra copy. Legacy rows may under-serve. */
export function Caveats({
  membership,
  newerPartial,
  newerUnattributed,
}: {
  membership: RecordedRunMembership;
  newerPartial: boolean;
  newerUnattributed: boolean;
}) {
  return (
    <>
      {membership === 'best_effort_legacy' && (
        <p className="muted caveat">
          Older observations may be incomplete - recorded before exact run tracking.
        </p>
      )}
      {newerPartial && (
        <p className="muted caveat">
          A newer partial observation exists - this view uses the latest complete one.
        </p>
      )}
      {newerUnattributed && (
        <p className="muted caveat">
          A newer sync's coverage was never recorded - this view may miss it.
        </p>
      )}
      <p className="muted caveat">
        Recorded observations only: spot balances and recorded Aave V3 positions. Unsupported
        items are never shown as zero.
      </p>
    </>
  );
}
