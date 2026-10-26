import Link from 'next/link';
import { PageIntro } from '@/components/ui';
import { CombinedWallets } from '@/features/portfolio/combined-wallets';
import { AccountBookPointer } from '@/features/portfolio/account-book-pointer';
export const metadata = { title: 'Legacy Track list' };

/** The legacy Track saved-address list, combined on request only. The Portfolio nav
 *  tab leads to the native account book on /account; this page stays reachable for the
 *  legacy list. The invented $12,000 sample portfolio lives under /demo. Neither is
 *  read or shown here. */
export default function Page() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="LEGACY TRACK · ALL NETWORKS" title="Legacy Track list">
        <p>
          This page keeps the older Track address list. The Portfolio tab leads to the address book
          on your <Link href="/account">Account</Link> page; the invented sample portfolio lives
          under <Link href="/demo">Demo</Link>.
        </p>
      </PageIntro>
      <AccountBookPointer />
      <CombinedWallets />
    </div>
  );
}
