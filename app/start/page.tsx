import { MovedPage } from '@/features/education/moved-page';
export const metadata = {
  title: 'This lesson has moved',
  alternates: { canonical: '/learn/start-here/' },
};
export default function Page() {
  return <MovedPage to="/learn/start-here/" title="Blockchain basics" />;
}
