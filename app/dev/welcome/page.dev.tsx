import { PageIntro } from '@/components/ui';
import { WelcomeDoor } from '@/features/auth-v2/welcome-door';
export const metadata = { title: 'Welcome (preview build)' };

/** v0.2 native welcome/door: the entry of the native journey. */
export default function WelcomePreview() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="PREVIEW BUILD" title="Sola Lens.">
        <p>Read-only portfolio tracking. No transactions, ever.</p>
      </PageIntro>
      <WelcomeDoor />
    </div>
  );
}
