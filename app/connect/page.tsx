import { PageIntro, ActionLink } from '@/components/ui';
export const metadata = { title: 'Connect or watch' };
export default function Connect() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="READ-ONLY ACCESS" title="Connect or watch.">
        <p>
          Connect a supported browser wallet, or watch a public address without claiming ownership.
        </p>
      </PageIntro>
      <section className="panel">
        <h2>Wallet sign-in</h2>
        <p>
          Connection shares a public address. A separate sign-in message proves control. No
          transactions, token approvals, seed phrases or private keys. Preview access still needs an
          invitation.
        </p>
        <ActionLink href="/sign-in">Sign in with a wallet or email</ActionLink>
        <ActionLink href="/create-account" secondary>
          Create account
        </ActionLink>
      </section>
      <section className="panel">
        <h2>Watch a public address</h2>
        <p>
          Invited accounts can save labeled public addresses without a wallet signature. Watched
          addresses do not prove ownership. Data is loaded only when requested, with coverage and
          observation times.
        </p>
        <ActionLink href="/account" secondary>
          Addresses &amp; Wallets
        </ActionLink>
      </section>
      <ActionLink href="/learn" secondary>
        Browse the lessons
      </ActionLink>
    </div>
  );
}
