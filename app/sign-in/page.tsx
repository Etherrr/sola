import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Sign in' };

export default function SignIn() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SOLA ACCOUNT" title="Sign in.">
        <p>One email code, no password. Never a seed phrase, key, transaction or approval.</p>
      </PageIntro>
      <section className="panel">
        <SignInForm />
      </section>
      <p className="notice">
        No account? The <a href="/portfolio">Legacy Track list</a> stays open without one.
      </p>
    </div>
  );
}
