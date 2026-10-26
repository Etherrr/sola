import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/networks/' },
};
export default function Page() {
  return <MovedPage to="/learn/networks/" title="Understand networks" />;
}
