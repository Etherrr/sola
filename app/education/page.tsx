import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'Education has moved',
  alternates: { canonical: '/learn/' },
};
export default function Page() {
  return <MovedPage to="/learn/" title="Education" />;
}
