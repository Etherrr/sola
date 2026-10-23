import { PageIntro, ActionLink } from '@/components/ui';
import { ModeMarker } from '@/components/mode-marker';
import { TrackForm } from '@/features/portfolio/track-form';
export const metadata = { title: 'Address lookup (simulated)' };
export default function Track() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="WATCH-ONLY · SIMULATED" title="Track a public address.">
        <p>
          Paste a public Ethereum address to try the lookup flow. For now the results come from
          fixed simulated examples inside this app, not from a blockchain, so no real balances are
          shown. Live data stays off until it is separately approved.
        </p>
      </PageIntro>
      <ModeMarker
        mode="SIMULATED"
        note="Results here are simulated fixtures. No live data, no wallet, nothing is signed."
      />
      <TrackForm />
      <section className="notice" aria-labelledby="track-promise">
        <h2 id="track-promise">What it does and does not do</h2>
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
