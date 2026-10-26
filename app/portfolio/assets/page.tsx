import { PortfolioMovedPage } from '@/features/portfolio-v2/moved-page';
export const metadata = { title: 'Assets', alternates: { canonical: '/account/assets/' } };
export default function Page() {
  return <PortfolioMovedPage to="/account/assets/" title="Assets" />;
}
