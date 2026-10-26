import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/security/' },
};
export default function Page() {
  return <MovedPage to="/learn/security/" title="Security first" />;
}
