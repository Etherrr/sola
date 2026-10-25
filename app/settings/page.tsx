import { PageIntro } from '@/components/ui';
import { PrivacySettings } from '@/features/onboarding/privacy-settings';
export const metadata = { title: 'Privacy & settings' };
export default function Settings() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SETTINGS & PRIVACY" title="Your access. Your data.">
        <p>Verified access and clear limits on what this app keeps.</p>
      </PageIntro>
      <PrivacySettings />
      <section className="panel">
        <h2>About this preview</h2>
        <p>
          Cloudflare Access verifies your signed-in identity. Sola does not create passwords or save
          address lists. Overview is a simulated sample. Track can read supported public balances
          through PublicNode when this deployment enables live mode; its form discloses where the
          address goes before lookup. Market data is not connected. There are no wallet connections
          or transaction features. Page requests reach the app host.
        </p>
        <p>
          External links open third-party websites under their own terms. This app loads no external
          fonts, trackers, or wallet scripts. This preview is protected by Cloudflare Access. A
          formal privacy review is still required before any public launch.
        </p>
      </section>
    </div>
  );
}
