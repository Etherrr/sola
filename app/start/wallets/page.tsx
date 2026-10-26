import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/wallets/' },
};
export default function Page() {
  return <MovedPage to="/learn/wallets/" title="Choose how to hold your keys" />;
}
