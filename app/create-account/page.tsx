import { WalletPanel } from '@/features/auth-v2/wallet-panel';
import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Create account' };

export default function CreateAccount() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SOLA ACCOUNT" title="Create account.">
        <p>Start with a wallet message or an email code. Preview portfolio access still needs an invitation.</p>
      </PageIntro>
      <WalletPanel />
      <section className="panel">
        <SignInForm context="create-account" />
      </section>
    </div>
  );
}
