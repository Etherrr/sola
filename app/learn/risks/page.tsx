import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/lending-and-risk/' },
};
export default function Page() {
  return <MovedPage to="/learn/lending-and-risk/" title="Lending, staking and liquidity" />;
}
