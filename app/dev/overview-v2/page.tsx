import { SignedOutGate } from '@/features/portfolio-v2/signed-out-gate';
import { WhatChanged } from '@/features/portfolio-v2/what-changed';
import { SnapshotConsent } from '@/features/portfolio-v2/snapshot-consent';
import { AddressBook } from '@/features/portfolio-v2/address-book';
import { AddressLookup } from '@/features/portfolio-v2/address-lookup';
import { CombinedBalances } from '@/features/portfolio-v2/combined-balances';
import { CombinedProvider } from '@/features/portfolio-v2/combined-context';
import { AllocationV2 } from '@/features/portfolio-v2/allocation';
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

      <CombinedProvider>
      <section className="panel">
        <h2>Holdings</h2>
        <SignedOutGate>
          <div className="ov2-block">
            <HoldingsTable />
          </div>
          <div className="ov2-block" id="ov2-addresses">
            <h3 className="ov2-h3">Addresses &amp; Wallets</h3>
            <AddressBook />
          </div>
          <div className="ov2-block">
            <AddressLookup />
          </div>
          <div className="ov2-block">
            <CombinedBalances />
          </div>
          <div className="ov2-block">
            <SnapshotConsent />
          </div>
          <div className="ov2-block">
            <h3 className="ov2-h3">What changed</h3>
            <WhatChanged />
          </div>
        </SignedOutGate>
      </section>

      <section className="panel">
        <h2>Debt</h2>
        <p className="ov2-quiet">
          No debt loaded. Debt is always shown separately, never netted into balances.
        </p>
      </section>

      <section className="panel">
        <h2>Allocation</h2>
        <AllocationV2 />
      </section>
      </CombinedProvider>
    </div>
  );
}
