import { WhatChanged } from '@/features/portfolio-v2/what-changed';
export const metadata = { title: 'Overview (preview build)' };

/** v0.2 Overview - concise and action-first (user steering 2026-10-25):
 *  holdings / debt / allocation, no explanation walls. Honest terse states:
 *  nothing here is connected to live holdings yet except What changed, which
 *  reads the wired history route for the signed-in user. */
export default function OverviewV2() {
  return (
    <div className="page-container">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>Overview.</h1>

      <section className="panel">
        <h2>Holdings</h2>
        <p>
          <em>No holdings loaded - connect an address to load them.</em>
        </p>
        <WhatChanged />
      </section>

      <section className="panel">
        <h2>Debt</h2>
        <p>
          <em>No debt loaded. Debt is always shown separately, never netted into balances.</em>
        </p>
      </section>

      <section className="panel">
        <h2>Allocation</h2>
        <p>
          <em>Allocation appears once holdings load.</em>
        </p>
      </section>
    </div>
  );
}
