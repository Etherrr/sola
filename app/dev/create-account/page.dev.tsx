import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Create account (preview build)' };

/**
 * Distinct Create-account action (plan: distinct visible Sign in / Create
 * account). The verified flow is the same email-code challenge - the account
 * is created on first successful verification; invitation-only is stated
 * honestly, and an uninvited email gets the identical response (no
 * enumeration). Never asks for a seed phrase, key, transaction or approval.
 */
export default function CreateAccountPreview() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="PREVIEW BUILD" title="Create account.">
        <p>Enter the email your invitation went to - we email you a single-use code.</p>
      </PageIntro>
      <section className="panel">
        <SignInForm />
      </section>
    </div>
  );
}
