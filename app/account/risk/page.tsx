import { RiskView } from '@/features/portfolio-v2/risk-view';
export const metadata = { title: 'Risk & Return' };
export default function Page() {
  return <div className="page-container ov2"><p className="eyebrow">PORTFOLIO · RECORDED OBSERVATIONS</p><h1>Risk &amp; Return.</h1><RiskView /></div>;
}
