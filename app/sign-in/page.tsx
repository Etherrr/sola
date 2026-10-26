import { WalletPanel } from '@/features/auth-v2/wallet-panel';
import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Sign in' };

export default function SignIn() {
  return (
    <div className="page-container narrow sign-in-page">
      <PageIntro eyebrow="SOLA ACCOUNT" title="Sign in.">
        <p>Choose a wallet, email code or a passkey you have set up.</p>
      </PageIntro>
      <WalletPanel />
      <section className="panel email-sign-in" aria-label="Email or passkey sign-in">
        <SignInForm />
      </section>
    </div>
  );
}
