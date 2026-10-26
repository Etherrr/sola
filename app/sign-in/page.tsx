import { WalletPanel } from '@/features/auth-v2/wallet-panel';
import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Sign in' };

export default function SignIn() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SOLA ACCOUNT" title="Sign in.">
        <p>Use a wallet message or an email code. Never a seed phrase, key, transaction or approval.</p>
      </PageIntro>
      <WalletPanel />
      <section className="panel">
        <SignInForm />
      </section>
    </div>
  );
}
