import { PageIntro, ActionLink } from '@/components/ui';
import { ModeMarker } from '@/components/mode-marker';
import { TrackForm } from '@/features/portfolio/track-form';
export const metadata = { title: 'Address lookup (simulated)' };
export default function Track() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="WATCH-ONLY · SIMULATED" title="Track a public address">
        <p>
          Look up an Ethereum address. Results are fixed simulated examples, not blockchain data.
          Live data stays off until it is separately approved.
        </p>
      </PageIntro>
      <ModeMarker
        mode="SIMULATED"
        note="Simulated fixtures. No live data, no wallet, nothing is signed."
      />
      <TrackForm />
      <details className="limits">
        <summary>What it does and does not do</summary>
        <ul>
          <li>
            It reads public addresses only. It never asks for a seed phrase, private key or
            signature.
          </li>
          <li>A pasted address is observed, not proven to be yours.</li>
          <li>
            Wallet balances are not total net worth: deposits, staking, debts and other positions
            may be missing.
          </li>
          <li>A missing price will show as Unknown, never zero.</li>
        </ul>
      </details>
      <div className="actions">
        <ActionLink href="/portfolio">Explore the demo →</ActionLink>
        <ActionLink href="/learn" secondary>
          Learn DeFi →
        </ActionLink>
      </div>
    </div>
  );
}
