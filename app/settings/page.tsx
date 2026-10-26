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
          Sola sign-in uses an email code or a passkey you have set up. Your account saves
          labeled watched public addresses; a watched address does not prove wallet ownership.
          Manage addresses, rename or remove them from Addresses &amp; Wallets. The Overview,
          Assets, DeFi and Risk &amp; Return pages use recorded observations, not invented balances.
          History recording is off until you choose it. Refresh then reads saved addresses through
          PublicNode and the documented Solana fallback, then records observations under your account. Withdrawing recording
          deletes that recorded history after confirmation. Read-only lookups and recording are
          separate actions. Ethereum and Aave V3 coverage is limited; Solana supports SOL only.
          Markets uses selected Solana DEX pools through DexScreener. Tokenized equities are
          on-chain tokens, not the underlying stocks. No transactions or approvals are requested.
        </p>
        <p>
          External links open third-party websites under their own terms. This app loads no external
          fonts, trackers, or wallet scripts. Protected pages require an invited Sola account. Legacy address and migration pages retain an extra sign-in for ownership checks. A
          formal privacy review is still required before any public launch.
        </p>
      </section>
    </div>
  );
}
