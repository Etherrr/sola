import { PageIntro } from '@/components/ui';
import { WelcomeDoor } from '@/features/auth-v2/welcome-door';
export const metadata = { title: 'Your Sola account' };
export default function Page() {
  return <div className="page-container narrow"><PageIntro eyebrow="SOLA ACCOUNT" title="Your Sola account."><p>Choose where to begin, or sign in.</p></PageIntro><WelcomeDoor /></div>;
}
