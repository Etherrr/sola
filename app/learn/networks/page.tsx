import Link from 'next/link';
import { PageIntro, ActionLink } from '@/components/ui';
export const metadata = { title: 'Understand networks' };
export default function Networks() {
  return (
    <div className="page-container narrow">
      <div className="onboarding-controls">
        <Link href="/learn/addresses">← Back</Link>
        <Link href="/learn/defi-strategies">Skip →</Link>
        <Link href="/">Exit</Link>
      </div>
      <PageIntro eyebrow="NETWORK FIELD NOTES" title="Same idea. Different networks.">
        <p>Assets and accounts exist in a network context. Always check where you are.</p>
      </PageIntro>
      <div className="panel">
        <h2>Ethereum & EVM networks</h2>
        <p>
          Ethereum uses ETH for network costs. Other EVM networks have their own state and costs. A
          familiar address format does not mean the same balance exists everywhere.
        </p>
      </div>
      <div className="panel">
        <h2>Solana</h2>
        <p>
          Solana uses SOL for network costs and a different account model. Token mint identity
          matters; symbols alone are not enough to identify assets.
        </p>
      </div>
      <div className="notice">
        Sending across networks and using bridges introduce additional risk. This preview offers
        neither transfers nor bridging.
      </div>
      <ActionLink href="/learn/defi-strategies">Continue to the swap lesson →</ActionLink>
    </div>
  );
}
