import { PageIntro, ActionLink } from '@/components/ui';
import { ModeMarker } from '@/components/mode-marker';
export const metadata = { title: 'Address lookup (coming next)' };
export default function Track() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="WATCH-ONLY · COMING NEXT" title="Track a public address.">
        <p>
          Soon you will be able to paste a public Ethereum address and see wallet balances, clearly
          separated from the demo. Live lookup is not switched on in this preview, so nothing on
          this page reads a blockchain or sends an address anywhere.
        </p>
      </PageIntro>
      <ModeMarker
        mode="SIMULATED"
        note="This preview shows no live data. The demo portfolio and lessons are fully simulated."
      />
      <section className="notice" aria-labelledby="track-promise">
        <h2 id="track-promise">What it will and will not do</h2>
        <ul>
          <li>
            It will read public balances only. It will never ask for a seed phrase, private key or
            signature.
          </li>
          <li>A pasted address is observed, not proven to be yours.</li>
          <li>
            Wallet balances are not total net worth: deposits, staking, debts and other positions
            may be missing.
          </li>
          <li>A missing price will show as Unknown, never zero.</li>
        </ul>
      </section>
      <div className="actions">
        <ActionLink href="/portfolio">Explore the demo →</ActionLink>
        <ActionLink href="/learn" secondary>
          Learn DeFi →
        </ActionLink>
      </div>
    </div>
  );
}
