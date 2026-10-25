import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Sign in (preview build)' };

/**
 * Functional native sign-in UI on the preview: real email-code challenge and
 * verify against the live routes. Message signatures / wallet linking come
 * AFTER this gate clears review; this page never asks for a seed phrase,
 * private key, transaction or token approval.
 */
export default function SignInPreview() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="PREVIEW BUILD" title="Sign in.">
        <p>
          One email code, no password. Use the email you were invited with - a session alone does
          not unlock portfolio data; invited accounts only. This flow never asks for a seed
          phrase, a private key, a transaction, or a token approval.
        </p>
      </PageIntro>
      <section className="panel">
        <SignInForm />
      </section>
    </div>
  );
}
