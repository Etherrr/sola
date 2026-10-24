import { ActionLink } from '@/components/ui';
import { TrackApp } from '@/features/portfolio/track-intro';
export const metadata = { title: 'Address lookup' };
export default function Track() {
  return (
    <div className="page-container">
      <TrackApp />
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
