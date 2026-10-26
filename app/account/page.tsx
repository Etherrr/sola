import { PageIntro } from '@/components/ui';
import { AccountGate } from '@/features/auth-v2/account-gate';
export const metadata = { title: 'Addresses & Wallets' };

/** The protected native account page: saved addresses and sign-out, behind
 *  the native session gate with an honest not-invited state. */
export default function Account() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="ACCOUNT" title="Addresses &amp; Wallets">
        <p>Labeled public addresses saved to your account.</p>
      </PageIntro>
      <AccountGate />
    </div>
  );
}
