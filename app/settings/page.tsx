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
        <h2>Sign-in and saved addresses</h2>
        <p>
          Sign in with a wallet message, an email code or a passkey you have set up. Preview access
          requires an invitation. A watched public address does not prove wallet ownership. Your
          account saves labeled watched public addresses. Rename or remove them in Addresses &amp;
          Wallets.
        </p>
        <p>
          Importing previously saved addresses requires a separate sign-in check. Nothing moves
          until you choose it. Wallet-only accounts have no email recovery; add a passkey after
          signing in.
        </p>
      </section>
      <section className="panel">
        <h2>Observations and history</h2>
        <p>
          Overview, Assets, DeFi and Risk &amp; Return use recorded observations, not invented
          balances. History recording is off until you choose it. Refresh then reads saved addresses
          through PublicNode and the documented Solana fallback and records the results under your
          account. Withdrawing recording deletes that history after confirmation. Read-only lookups
          and history recording are separate actions.
        </p>
        <p>
          Ethereum and Aave V3 coverage is limited. Solana supports SOL only. Markets uses selected
          Solana DEX pools through DexScreener. Tokenized equities are on-chain tokens, not the
          underlying stocks. No transactions or token approvals are requested.
        </p>
      </section>
      <section className="panel">
        <h2>Privacy and external links</h2>
        <p>
          This app loads no external fonts, trackers or wallet scripts. External links open
          third-party websites under their own terms. A formal privacy review is still required
          before any public launch.
        </p>
      </section>
    </div>
  );
}
