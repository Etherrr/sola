import { PageIntro } from '@/components/ui';
import { PrivacySettings } from '@/features/onboarding/privacy-settings';
export const metadata = { title: 'Privacy & settings' };
export default function Settings() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="SETTINGS & PRIVACY" title="Keep control of your learning.">
        <p>A simple preview with a small data footprint.</p>
      </PageIntro>
      <PrivacySettings />
      <section className="panel">
        <h2>About this preview</h2>
        <p>
          Sola Lens v0.1 uses deterministic examples. The app has no accounts or passwords of its
          own (access is controlled by Cloudflare Access), and no provider APIs, wallet connections,
          or transaction features. Page requests reach the app host; browser-local progress is not
          sent to Sola.
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
