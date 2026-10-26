import Link from 'next/link';
import { PageIntro } from '@/components/ui';
import { CombinedWallets } from '@/features/portfolio/combined-wallets';
import { AccountBookPointer } from '@/features/portfolio/account-book-pointer';
export const metadata = { title: 'Saved addresses' };

/** Preserves existing bookmarks and the separately protected saved-address store. */
export default function Page() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="SAVED ADDRESSES" title="Saved addresses">
        <p>
          Addresses saved with your previous sign-in stay here until you choose to import them.
          Use <Link href="/account">Addresses &amp; Wallets</Link> for your Sola account.
          Nothing moves automatically.
        </p>
      </PageIntro>
      <AccountBookPointer />
      <CombinedWallets />
    </div>
  );
}
