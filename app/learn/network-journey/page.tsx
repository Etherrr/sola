import Link from 'next/link';
import { PageIntro } from '@/components/ui';
import { NetworkJourney } from '@/features/education/network-journey';
export const metadata = { title: 'Ethereum transfer journey' };
export default function Page() {
  return (
    <div className="page-container">
      <PageIntro
        eyebrow="LEARN BY DOING"
        title="How an Ethereum transfer moves through the network."
      >
        <p>
          Watch a pretend ETH transfer between two fictional people. Pause, step or scrub whenever
          you like. Everything below is also written out as text.
        </p>
      </PageIntro>
      <NetworkJourney />
      <p className="notice">
        This scene is specific to Ethereum: its accounts, gas, base fee, validators and finality.
        Bitcoin, Solana and other networks work differently. Sources:{' '}
        <a
          href="https://ethereum.org/developers/docs/transactions/"
          target="_blank"
          rel="noopener noreferrer"
        >
          ethereum.org transactions
        </a>
        ,{' '}
        <a
          href="https://ethereum.org/developers/docs/gas/"
          target="_blank"
          rel="noopener noreferrer"
        >
          gas and fees
        </a>
        ,{' '}
        <a
          href="https://ethereum.org/developers/docs/consensus-mechanisms/pos/gasper/"
          target="_blank"
          rel="noopener noreferrer"
        >
          finality
        </a>
        . <Link href="/learn">Back to the learning library</Link>
      </p>
    </div>
  );
}
