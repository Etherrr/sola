import { PortfolioMovedPage } from '@/features/portfolio-v2/moved-page';
export const metadata = { title: 'Risk & Return', alternates: { canonical: '/account/risk/' } };
export default function Page() {
  return <PortfolioMovedPage to="/account/risk/" title="Risk & Return" />;
}
