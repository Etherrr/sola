import { PageIntro, ActionLink } from '@/components/ui';
export const metadata = { title: 'Start here' };
export default function Welcome() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="START HERE" title="What this app does, honestly.">
        <p>
          A short orientation: what each area reads, what is never done, and where account
          controls live. It starts no address lookups and no wallet actions.
        </p>
      </PageIntro>
      <section className="panel">
        <h2>The areas</h2>
        <p>
          Overview combines your saved public addresses into one read-only view, only when you
          ask; real chain reads with per-source observation times sit above a clearly labeled
          invented demo. Track looks up one pasted public address at a time: on Ethereum it reads
          ETH and a short token list (USDC, USDT, DAI, WETH), and on Solana it reads the SOL
          balance only. Markets shows prices for a fixed list of Solana instruments from selected
          DEX pools reported by DexScreener; tokenized equities there are on-chain tokens, not the
          underlying stocks. Education holds short explainers, and Settings covers access, privacy
          and what this app keeps.
        </p>
      </section>
      <section className="panel">
        <h2>Saved addresses</h2>
        <p>
          Saved addresses live under your verified sign-in so the combined view works across
          devices. A saved address is observed, not proven to be yours. You can rename or remove
          one at any time from Track, and reads happen only when you ask for them - nothing
          auto-refreshes and no alerts exist.
        </p>
      </section>
      <section className="panel">
        <h2>Honest limits</h2>
        <p>
          No wallet ever connects here, nothing is signed, and no transactions exist. SPL tokens
          (including USDC and USDT on Solana), NFTs and DeFi positions are not read, and a missing
          token is not a zero balance. A source can be busy or unavailable; the app says so and
          never substitutes an invented number. There is no total account value, no balance
          history and no price alerts.
        </p>
      </section>
      <section className="panel">
        <h2>Entry and sign out</h2>
        <p>
          Cloudflare Access verifies your identity by email code before any page loads; Sola
          creates no passwords. Sign out lives in the account menu in the top bar and ends this
          protected session and, as disclosed there, other apps on the same Access account. A
          Sola-native sign-in exists only as a design preview on the onboarding page.
        </p>
        <p>
          <ActionLink href="/portfolio">Open Overview →</ActionLink>{' '}
          <ActionLink href="/track" secondary>
            Look up an address →
          </ActionLink>{' '}
          <ActionLink href="/settings" secondary>
            Privacy and settings →
          </ActionLink>
        </p>
      </section>
    </div>
  );
}
