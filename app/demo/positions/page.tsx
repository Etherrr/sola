import { PortfolioMovedPage } from '@/features/portfolio-v2/moved-page';
export const metadata = { title: 'DeFi', alternates: { canonical: '/account/defi/' } };
export default function Page() {
  return <PortfolioMovedPage to="/account/defi/" title="DeFi" />;
}
