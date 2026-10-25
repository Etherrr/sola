import { WhatChanged } from '@/features/portfolio-v2/what-changed';
import { SnapshotConsent } from '@/features/portfolio-v2/snapshot-consent';
import { AddressBook } from '@/features/portfolio-v2/address-book';
import { HoldingsTable } from '@/features/portfolio-v2/holdings-table';
export const metadata = { title: 'Overview (preview build)' };

/** v0.2 Overview - concise and action-first (user steering 2026-10-25):
 *  holdings / debt / allocation, no explanation walls. Honest terse states:
 *  nothing here is connected to live holdings yet except What changed, which
 *  reads the wired history route for the signed-in user. */
export default function OverviewV2() {
  return (
    <div className="page-container ov2">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>Overview.</h1>

      <section className="panel">
        <h2>Holdings</h2>
        <div className="ov2-block">
          <HoldingsTable />
        </div>
        <div className="ov2-block">
          <AddressBook />
        </div>
        <div className="ov2-block">
          <SnapshotConsent />
        </div>
        <div className="ov2-block">
          <WhatChanged />
        </div>
      </section>

      <section className="panel">
        <h2>Debt</h2>
        <p className="ov2-quiet">
          No debt loaded. Debt is always shown separately, never netted into balances.
        </p>
      </section>

      <section className="panel">
        <h2>Allocation</h2>
        <p className="ov2-quiet">Allocation appears once holdings load.</p>
      </section>
    </div>
  );
}
