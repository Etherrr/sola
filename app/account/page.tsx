import { PageIntro } from '@/components/ui';
import { AccountGate } from '@/features/auth-v2/account-gate';
export const metadata = { title: 'Your account' };

/** The protected native account page: saved addresses and sign-out, behind
 *  the native session gate with an honest not-invited state. */
export default function Account() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="ACCOUNT" title="Your addresses.">
        <p>Labeled public addresses saved to your account. Watching is not ownership.</p>
      </PageIntro>
      <AccountGate />
    </div>
  );
}
