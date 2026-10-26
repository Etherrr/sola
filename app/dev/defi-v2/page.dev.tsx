import { DefiView } from '@/features/portfolio-v2/defi-view';
export const metadata = { title: 'DeFi (preview build)' };
/** Plan 6.3 DeFi - recorded protocol positions, read-only. Preview build. */
export default function DefiV2() {
  return (
    <div className="page-container ov2">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>DeFi.</h1>
      <DefiView />
    </div>
  );
}
