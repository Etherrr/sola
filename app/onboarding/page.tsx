import { PageIntro } from '@/components/ui';
export const metadata = { title: 'Native entry prototype' };
export default function OnboardingPrototype() {
  return (
    <div className="page-container narrow">
      <PageIntro eyebrow="VISUAL PROTOTYPE · NOT FUNCTIONAL" title="The future Sola sign-in.">
        <p>
          This page is a design preview only. Nothing here signs you in, sends a code, connects a
          wallet, or changes your account. Entry today stays exactly as it was: Cloudflare Access
          verifies your identity by email code before any page loads.
        </p>
      </PageIntro>
      <section className="panel">
        <h2>How entry works today</h2>
        <p>
          Cloudflare Access checks every visit before this app loads and tells the app which
          verified identity is here. Your saved addresses, the combined portfolio view and sign
          out (account menu, top bar) all key off that verified identity. This prototype changes
          none of that.
        </p>
        <span className="badge">CURRENT · UNCHANGED</span>
      </section>
      <section className="panel">
        <h2>Proposed: Sola-native sign-in</h2>
        <p>
          A future Sola-owned sign-in: enter your email, receive a one-time code, done. Whether
          that can protect the app as well as today's gate is a security question still being
          validated - Cloudflare Access stays unchanged unless a replacement is proven and
          explicitly approved. This is a mock; the controls are disabled and nothing is sent
          anywhere.
        </p>
        <p>
          <input type="email" disabled placeholder="you@example.com" aria-label="Email (prototype, disabled)" />{' '}
          <button type="button" className="button primary" disabled>
            Send sign-in code
          </button>
        </p>
        <p>
          <input disabled placeholder="8-digit code" aria-label="Code (prototype, disabled)" />{' '}
          <button type="button" className="button secondary" disabled>
            Verify
          </button>
        </p>
        <span className="badge">PROTOTYPE · DISABLED · NO SESSION IS CREATED</span>
      </section>
      <section className="panel">
        <h2>Proposed: connect a wallet as login</h2>
        <p>
          Also under consideration: sign in by proving a wallet. Connecting a wallet alone never
          proves ownership and would never grant access here; that path needs a verified signature
          and an explicit owner decision, which is still open. The control is a disabled mock.
        </p>
        <p>
          <button type="button" className="button primary" disabled>
            Connect wallet
          </button>
        </p>
        <span className="badge">PROTOTYPE · DISABLED · DECISION PENDING</span>
      </section>
      <section className="panel">
        <h2>Proposed: one account, several wallets</h2>
        <p>
          The direction on record: several wallets under one Sola account, upgraded automatically
          when another wallet attaches. Today the same need is met without any wallet connection:
          save several labeled public addresses and the combined view reads them together,
          read-only.
        </p>
        <span className="badge">DESIGN NOTE</span>
      </section>
      <p className="notice">
        Design preview only. No route, gate, sign-in or account behavior changes on this page.
      </p>
    </div>
  );
}
