import { Dashboard } from '@/features/portfolio/dashboard';
export const metadata = { title: 'Simulated portfolio — positions' };
export default function Page() {
  return <Dashboard view="positions" />;
}
