import Link from 'next/link';
import { PageIntro } from '@/components/ui';
import { CombinedWallets } from '@/features/portfolio/combined-wallets';
export const metadata = { title: 'Overview' };

/** The app overview: the legacy Track saved-address list, combined on request only.
 *  The native account book and its own combined view live on /account; the invented
 *  $12,000 sample portfolio lives under /demo. Neither is read or shown here. */
export default function Page() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="PORTFOLIO · ALL NETWORKS" title="Overview">
        <p>
          Combine the public addresses saved in your Track list, loaded only when you ask. This is
          the legacy Track list - separate from the address book on your{' '}
          <Link href="/account">Account</Link> page. The invented sample portfolio lives under{' '}
          <Link href="/demo">Demo</Link>.
        </p>
      </PageIntro>
      <CombinedWallets />
    </div>
  );
}
