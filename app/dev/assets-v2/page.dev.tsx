import { AssetsView } from '@/features/portfolio-v2/assets-view';
export const metadata = { title: 'Assets (preview build)' };
/** Plan 6.2 Assets - recorded holdings, unified and searchable. Preview build. */
export default function AssetsV2() {
  return (
    <div className="page-container ov2">
      <p className="eyebrow">PORTFOLIO V2 · PREVIEW BUILD</p>
      <h1>Assets.</h1>
      <AssetsView />
    </div>
  );
}
