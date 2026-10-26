import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/defi-strategies/' },
};
export default function Page() {
  return <MovedPage to="/learn/defi-strategies/" title="Solana and swap education" />;
}
