import { PageIntro } from '@/components/ui';
import { SignInForm } from '@/features/auth-v2/sign-in-form';
export const metadata = { title: 'Create account' };

export default function CreateAccount() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SOLA ACCOUNT" title="Create account.">
        <p>Enter the email your invitation went to - we email you a single-use code.</p>
      </PageIntro>
      <section className="panel">
        <SignInForm />
      </section>
    </div>
  );
}
