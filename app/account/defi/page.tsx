import { DefiView } from '@/features/portfolio-v2/defi-view';
export const metadata = { title: 'DeFi' };
export default function Page() {
  return <div className="page-container ov2"><p className="eyebrow">PORTFOLIO · RECORDED OBSERVATIONS</p><h1>DeFi.</h1><DefiView /></div>;
}
