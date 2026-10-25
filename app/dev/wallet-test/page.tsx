import { PageIntro } from '@/components/ui';
export const metadata = { title: 'Wallet sign-in test (preview only)' };

/**
 * Human-fixture test page for the v0.2 wallet LINK flow (Phase C preview).
 * It shows, in plain words, EXACTLY what a tester is asked to approve when
 * linking a wallet - before any route is enabled. Signing here (once enabled)
 * is a MESSAGE SIGNATURE ONLY: it proves wallet ownership for sign-in. It is
 * never a transaction, never a token approval, never a spending permission.
 */
export default function WalletTest() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="PREVIEW TEST PAGE" title="Wallet sign-in test.">
        <p>
          This page is for testing the new wallet sign-in on the preview site. Nothing here moves
          funds or grants spending permission - ever.
        </p>
      </PageIntro>

      <section className="panel">
        <h2>What you are asked to approve</h2>
        <p>
          Linking a wallet asks your wallet app to <strong>sign a plain-text message</strong>. The
          signature proves you hold the wallet, so the preview can treat it as yours. Signing a
          message is free (no gas) and cannot move funds.
        </p>
        <p>The exact message an Ethereum wallet shows looks like this:</p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            maxWidth: '100%',
            background: 'rgba(255,255,255,0.05)',
            padding: '1rem',
            borderRadius: '0.5rem',
            fontSize: '0.85rem',
          }}
        >
{`preview.solacapitalpartners.com wants you to sign in with your Ethereum account:
0xYourAddress...

Sign in to Sola Lens preview to link this wallet to your account.

URI: https://preview.solacapitalpartners.com/signin
Version: 1
Chain ID: 1
Nonce: <one-time code, valid 10 minutes>
Issued At: <timestamp>`}
        </pre>
        <p>
          A Solana wallet shows the same fields as plain text. If your wallet ever shows a
          transaction, an approval, or a spending cap instead of plain text like this,{' '}
          <strong>cancel and report it</strong> - that is not this flow.
        </p>
      </section>

      <section className="panel">
        <h2>What this flow never asks for</h2>
        <ul>
          <li>No transaction signing - no funds can move.</li>
          <li>No token approvals or allowances.</li>
          <li>No seed phrase, private key, or password - those are never typed anywhere.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Status</h2>
        <p>
          The sign-in API is being enabled on this preview in stages, behind review. The connect
          button below activates when the secured routes go live on this deployment.
        </p>
        <p>
          <button type="button" disabled style={{ opacity: 0.5 }}>
            Connect wallet (not yet enabled)
          </button>
        </p>
      </section>
    </div>
  );
}
