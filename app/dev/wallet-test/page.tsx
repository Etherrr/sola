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
          Linking a wallet asks your wallet app to{' '}
          <strong>sign one short, domain-bound, expiring authentication message</strong> - a plain
          personal_sign on EVM or signMessage on Solana. It never uses permit or typed-data
          payloads. That
          specific Sola sign-in message is not a transaction and grants no spending approval - it
          only proves you control the wallet, so the preview can treat it as yours. Other apps can
          ask for very different signatures that DO move funds or grant permissions, so always read
          exactly what your wallet asks you to sign, every time.
        </p>
        <p>
          An EVM wallet shows a sign-in message in this shape. This example is illustrative only -
          the real domain, address, one-time code and expiry are generated at sign-in time and
          shown by your wallet:
        </p>
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
{`<the site's domain> wants you to sign in with your Ethereum account:
<your wallet address>

Sign in to Sola.

URI: <the page's address>
Version: 1
Chain ID: 1
Nonce: <one-time code>
Issued At: <timestamp>
Expiration Time: <timestamp, 10 minutes after issue>`}
        </pre>
        <p>
          Solana wallets sign a plain-text message with the same purpose and expiry instead; the
          Version and Chain ID fields above are EVM-specific. If your wallet ever shows a transaction, an approval,
          or a spending cap instead of a plain sign-in message, <strong>cancel and report it</strong>{' '}
          - that is not this flow.
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
