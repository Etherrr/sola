import { PortfolioMovedPage } from '@/features/portfolio-v2/moved-page';
export const metadata = { title: 'Overview', alternates: { canonical: '/account/overview/' } };
export default function Page() {
  return <PortfolioMovedPage to="/account/overview/" title="Overview" />;
}
