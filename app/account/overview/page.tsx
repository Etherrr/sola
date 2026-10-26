import Link from 'next/link';
import { OverviewView } from '@/features/portfolio-v2/overview-view';
import { WhatChanged } from '@/features/portfolio-v2/what-changed';
import { SnapshotConsent } from '@/features/portfolio-v2/snapshot-consent';
export const metadata = { title: 'Overview' };
export default function Page() {
  return <div className="page-container ov2">
    <p className="eyebrow">PORTFOLIO · RECORDED OBSERVATIONS</p>
    <h1>Overview.</h1>
    <p className="actions"><Link className="button secondary" href="/account">Manage addresses</Link></p>
    <OverviewView />
    <section className="panel"><h2>What changed</h2><WhatChanged /></section>
    <section className="panel"><h2>Recording &amp; refresh</h2><SnapshotConsent /></section>
  </div>;
}
