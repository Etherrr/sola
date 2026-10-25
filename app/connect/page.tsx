import { PageIntro, ActionLink } from '@/components/ui';
export const metadata = { title: 'Experienced user portal' };
export default function Connect() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="THE EXPERIENCED PATH" title="Straight to the perspective.">
        <p>
          Skip the introduction and go straight to the live read-only view. Nothing here
          connects a wallet, requests a signature, or moves funds.
        </p>
      </PageIntro>
      <div className="panel">
        <h2>Live public-address lookup</h2>
        <p>
          Track observes public addresses directly. Ethereum covers ETH plus USDC, USDT,
          DAI and WETH at the pasted address; Solana covers the SOL balance only. An
          unread balance is shown as unavailable, never as zero. Observing an address
          proves nothing about ownership.
        </p>
        <span className="badge">LIVE · READ-ONLY</span>
      </div>
      <div className="panel">
        <h2>Saved addresses, no wallet connection</h2>
        <p>
          Signed-in accounts save labeled public addresses per network and combine them
          in one read-only portfolio view. Sola Lens never requests wallet discovery or
          signatures; a separate demo fixture stays clearly labeled as invented.
        </p>
        <span className="badge">SAVED PER ACCOUNT</span>
      </div>
      <div className="actions">
        <ActionLink href="/portfolio">Open portfolio →</ActionLink>
        <ActionLink href="/onboarding" secondary>
          Preview the future sign-in (prototype)
        </ActionLink>
        <ActionLink href="/learn" secondary>
          Browse the lessons
        </ActionLink>
      </div>
    </div>
  );
}
