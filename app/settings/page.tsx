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
          Cloudflare Access verifies your signed-in identity; Sola creates no passwords. Your
          account saves labeled public addresses per verified identity so the combined view works
          across devices; you can rename or remove them at any time. The Portfolio page combines
          live read-only balances for your saved addresses and keeps a separate clearly labeled
          invented demo. Track reads supported public balances through PublicNode - and, only when PublicNode
          answers rate limiting, once through Solana's public RPC endpoint; its form discloses
          where the address goes before lookup. Markets shows selected Solana DEX pools through
          DexScreener; tokenized equities are on-chain tokens, not the underlying stocks. There are
          no wallet connections, signatures or transaction features. Balance history recording
          stays off until you turn it on from the Portfolio page; Refresh then reads your saved
          addresses
          through public chain nodes and stores the snapshot under your account, kept until you
          delete it - withdrawing deletes the recorded history. Page requests reach the app
          host.
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
