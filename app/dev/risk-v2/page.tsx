import { RiskView } from '@/features/portfolio-v2/risk-view';
export const metadata = { title: 'Risk & Return (preview build)' };
/** Plan 6.4 Risk & Return - recorded concentration and debt exposure, partial
 *  where coverage is partial. Preview build. */
export default function RiskV2() {
  return (
    <div className="page-container ov2">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>Risk &amp; Return.</h1>
      <RiskView />
    </div>
  );
}
