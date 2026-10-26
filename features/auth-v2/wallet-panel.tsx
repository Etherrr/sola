'use client';
/** Message-only customer wallet entry. Server routes remain separately gated. */
import { useEffect, useRef, useState } from 'react';
import { safeNextPath } from './next-path';
import { discoverWallets, type WalletChoice } from './wallet-connectors';
import { createWalletFlow, type WalletFlowState, type WalletFlowDeps } from './wallet-flow';
export function WalletPanel({
  link = false,
  discover = discoverWallets,
  deps,
}: {
  link?: boolean;
  discover?: typeof discoverWallets;
  deps?: WalletFlowDeps;
}) {
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [state, setState] = useState<WalletFlowState>({ kind: 'idle' });
  const [next] = useState(() =>
    typeof window === 'undefined'
      ? '/account/overview'
      : safeNextPath(new URLSearchParams(window.location.search).get('next')),
  );
  const [started, setStarted] = useState(false);
  const selected = useRef<string | null>(null);
  const flow = useRef<ReturnType<typeof createWalletFlow> | null>(null);
  useEffect(() => {
    selected.current = null;
    const f = createWalletFlow(setState, deps);
    flow.current = f;
    f.disconnect();
    return () => {
      f.dispose();
      flow.current = null;
    };
  }, [deps, link]);
  useEffect(() => {
    if (!started) return;
    return discover((next) => {
      if (selected.current && !next.some((c) => c.id === selected.current)) {
        selected.current = null;
        flow.current?.invalidate();
      }
      setChoices(next);
    });
  }, [started, discover]);
  const busy =
    state.kind === 'connecting' || state.kind === 'signing' || state.kind === 'verifying';
  return (
    <section className="panel" aria-label={link ? 'Verify and link wallet' : 'Wallet sign-in'}>
      <h2>{link ? 'Verify and link a wallet' : 'Sign in with a wallet'}</h2>
      <p>Read-only. No transactions, token approvals, seed phrases or private keys.</p>
      <p>
        Connecting shares a public address. Only a separate message signature proves control.
        Preview access still needs an invitation.
      </p>
      {!link && (
        <p>
          A wallet-only account has no email recovery. Losing access to the wallet can mean losing
          access to this account. Add a passkey after signing in.
        </p>
      )}
      {!started ? (
        <button type="button" className="button secondary" onClick={() => setStarted(true)}>
          Find wallets
        </button>
      ) : (
        <>
          {choices.length === 0 && (
            <p>
              No supported browser wallet found. This preview supports Ethereum mainnet message
              signing and Solana software-wallet raw message signing. Contract wallets and
              transaction-only hardware wallets are not supported. You can use email instead.
            </p>
          )}
          {choices.map((choice) => (
            <button
              type="button"
              className="button secondary"
              key={choice.id}
              disabled={busy || state.kind === 'uncertain'}
              onClick={() => {
                selected.current = choice.id;
                void flow.current?.connect(choice);
              }}
            >
              {choice.name} ({choice.network === 'evm' ? 'Ethereum' : 'Solana'})
            </button>
          ))}
        </>
      )}
      {(state.kind === 'connected' || state.kind === 'signing' || state.kind === 'verifying') && (
        <p>
          Selected public address: <span style={{ overflowWrap: 'anywhere' }}>{state.address}</span>
          . Not yet verified for this step.
        </p>
      )}
      {state.kind === 'connected' && (
        <button
          type="button"
          className="button primary"
          onClick={() => void flow.current?.sign(link)}
        >
          {link ? 'Sign message to verify and link' : 'Sign message to sign in'}
        </button>
      )}
      <p>
        Clearing this selection does not undo a sign-in or link that the server has already
        accepted.
      </p>
      {busy && (
        <p role="status">
          {state.kind === 'connecting'
            ? 'Waiting for wallet connection...'
            : state.kind === 'verifying'
              ? 'Checking the signed message with Sola...'
              : 'Waiting for the message step...'}
        </p>
      )}
      {state.kind === 'error' && <p role="alert">{state.message} Connect again before trying.</p>}
      {state.kind === 'done' && (
        <p role="status">
          {state.linked
            ? 'Wallet verified and linked. Reload your address book to confirm its current state.'
            : 'Signed in. Continue to your portfolio.'}{' '}
          {
            <a href={state.linked ? '/account' : next}>
              {state.linked ? 'Reload address book' : 'Continue'}
            </a>
          }
        </p>
      )}
      {state.kind === 'uncertain' && (
        <p role="alert">
          The server result could not be confirmed. A sign-in or link may have been saved.{' '}
          <a href={link ? '/account' : '/account/overview'}>
            Reload your account to check before trying again
          </a>
          .
        </p>
      )}
      {started && (
        <button
          disabled={state.kind === 'verifying' || state.kind === 'uncertain'}
          type="button"
          className="button secondary"
          onClick={() => {
            selected.current = null;
            flow.current?.disconnect();
          }}
        >
          Clear wallet selection
        </button>
      )}
    </section>
  );
}
