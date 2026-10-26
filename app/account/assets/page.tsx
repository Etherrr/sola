import { AssetsView } from '@/features/portfolio-v2/assets-view';
export const metadata = { title: 'Assets' };
export default function Page() {
  return <div className="page-container ov2"><p className="eyebrow">PORTFOLIO · RECORDED OBSERVATIONS</p><h1>Assets.</h1><AssetsView /></div>;
}
