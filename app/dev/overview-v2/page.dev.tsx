import { SignedOutGate } from '@/features/portfolio-v2/signed-out-gate';
import { WhatChanged } from '@/features/portfolio-v2/what-changed';
import { SnapshotConsent } from '@/features/portfolio-v2/snapshot-consent';
import { AddressBook } from '@/features/portfolio-v2/address-book';
import { OverviewView } from '@/features/portfolio-v2/overview-view';
export const metadata = { title: 'Overview (preview build)' };

/** v0.2 Overview (plan 6.1) - recognized priced value, separate recorded
 *  debt, allocation and actual-run history, all on the approved recorded
 *  wire. Preview build only; the real portfolio routes are untouched. The
 *  approved What-changed, address book and consent blocks are unchanged. */
export default function OverviewV2() {
  return (
    <div className="page-container ov2">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>Overview.</h1>

      <section className="panel">
        <h2>Portfolio</h2>
        <SignedOutGate>
          <div className="ov2-block">
            <OverviewView />
          </div>
          <div className="ov2-block">
            <h3 className="ov2-h3">What changed</h3>
            <WhatChanged />
          </div>
          <div className="ov2-block" id="ov2-addresses">
            <h3 className="ov2-h3">Addresses &amp; Wallets</h3>
            <AddressBook />
          </div>
          <div className="ov2-block">
            <SnapshotConsent />
          </div>
        </SignedOutGate>
      </section>
    </div>
  );
}
