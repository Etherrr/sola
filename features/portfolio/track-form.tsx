'use client';
import { useEffect, useRef, useState } from 'react';
import { ModeMarker } from '@/components/mode-marker';
import { lookupAddress, type LookupOutcome } from './api-client';

const SAMPLES: { label: string; address: string }[] = [
  { label: 'Empty wallet', address: '0x1111111111111111111111111111111111111110' },
  { label: 'Native only', address: '0x1111111111111111111111111111111111111111' },
  { label: 'Mixed tokens', address: '0x1111111111111111111111111111111111111112' },
  { label: 'Unknown price', address: '0x1111111111111111111111111111111111111113' },
  { label: 'Partial data', address: '0x1111111111111111111111111111111111111115' },
  { label: 'Source unavailable', address: '0x111111111111111111111111111111111111111f' },
];

const feedTime = (iso: string) => iso.slice(0, 16).replace('T', ' ') + ' UTC';
export function TrackForm({ mode = 'mock' }: { mode?: 'checking' | 'mock' | 'live' | 'unknown' }) {
  const examples = mode === 'mock';
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLDivElement>(null);
  // After a completed lookup, bring the result or error into view and move focus to it, so the
  // outcome is not hidden below the controls on a phone. Motion is skipped when the user asks.
  useEffect(() => {
    if (!outcome || !output.current) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    output.current.focus({ preventScroll: true });
    // Align the top of the outcome under the sticky bar when its start is not already comfortably
    // in view. 'nearest' would align the bottom of a tall result and hide its heading.
    const top = output.current.getBoundingClientRect().top;
    if (top < 72 || top > window.innerHeight - 160) {
      output.current.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    }
  }, [outcome]);

  async function run(raw: string) {
    // Never send an address before the mode is known: it could be a live lookup.
    if (mode === 'checking') return;
    const address = raw.trim();
    setOutcome(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setError(
        'Enter an Ethereum address: 0x followed by 40 hexadecimal characters. Names such as .eth are not supported yet.',
      );
      input.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    setOutcome(await lookupAddress(address));
    setBusy(false);
  }

  const ok = outcome?.kind === 'ok' ? outcome.data : null;
  return (
    <div className="track">
      <div className="track-input">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(value);
          }}
          noValidate
        >
          <label htmlFor="track-address">Public Ethereum address (Ethereum mainnet)</label>
          <input
            id="track-address"
            ref={input}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOutcome(null);
            }}
            readOnly={busy}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'track-error track-privacy' : 'track-privacy'}
          />
          <p id="track-privacy" className="fine">
            {mode === 'live'
              ? "A pasted address is sent to this app's lookup service and then to PublicNode, a public Ethereum node, to read its balances. PublicNode's policy text says it keeps data at most 24 hours; that is not verified. The address is not saved in your browser. It is observed, not proven to be yours."
              : mode === 'mock'
                ? "A pasted address is sent to this app's own lookup service and is not saved in your browser. It is observed, not proven to be yours."
                : "A pasted address is sent to this app's lookup service. This deployment's mode is not confirmed yet, so the lookup could be live, in which case the address is also sent to a public Ethereum node. It is not saved in your browser."}
          </p>
          {error && (
            <p id="track-error" role="alert" className="fine">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="button primary" type="submit" disabled={busy || mode === 'checking'}>
              {busy ? 'Looking up…' : mode === 'checking' ? 'Checking mode…' : 'Look up'}
            </button>
          </div>
        </form>
        {examples && (
          <div className="notice">
            <p>
              <strong>Simulated examples</strong> (fixed fixtures, not real wallets):
            </p>
            <div className="actions">
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="button secondary chip"
                  disabled={busy}
                  onClick={() => {
                    setValue(s.address);
                    void run(s.address);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="track-output" role="status" aria-live="polite" ref={output} tabIndex={-1}>
        {busy && <p>Looking up…</p>}
        {!busy && !outcome && (
          <p className="fine track-hint">
            {mode === 'mock'
              ? 'Results appear here. Pick a simulated example or paste an address.'
              : 'Results appear here. Paste an address.'}
          </p>
        )}
        {outcome?.kind === 'error' && (
          <div className="notice">
            <ModeMarker
              context="lookup result"
              mode="INCOMPLETE"
              note="No balances are shown because the lookup did not complete. This is not an empty wallet."
            />
            <p>{outcome.message}</p>
          </div>
        )}
        {ok && (
          <section aria-labelledby="track-result">
            <h2 id="track-result">Result</h2>
            <ModeMarker
              context="lookup result"
              mode={ok.partial ? 'INCOMPLETE' : ok.simulated ? 'SIMULATED' : 'LIVE_REFRESHED'}
              note={
                ok.simulated
                  ? 'Fixed fixture data from this app. Nothing was read from a blockchain and these are not real balances.'
                  : `Balances were read when you pressed Look up (${ok.generatedAt.slice(0, 19).replace('T', ' ')} UTC). Each price shows when its own feed last updated, which can be hours earlier.`
              }
            />
            {ok.wallets.map((w) => (
              <div key={w.address}>
                <p className="fine">Address: {w.address}</p>
                {w.assets.length === 0 ? (
                  <p>
                    {w.partial
                      ? 'Some balances could not be read. No nonzero balances are shown among the assets checked, but this result cannot tell whether the wallet is empty. See the notes below.'
                      : ok.simulated
                        ? 'No assets found for this fixture. An empty wallet is a valid result.'
                        : 'No ETH, USDC, USDT, DAI or WETH balance was found. Other tokens, NFTs and DeFi positions were not checked, so this does not show that the wallet is empty.'}
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <caption>Wallet balances (Ethereum). Prices in USD.</caption>
                      <thead>
                        <tr>
                          <th scope="col">Asset</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Price</th>
                          <th scope="col">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {w.assets.map((a) => (
                          <tr key={a.assetId}>
                            <th scope="row">{a.symbol}</th>
                            <td>{a.amount}</td>
                            <td>
                              {a.price === null ? 'Unknown' : `$${a.price}`}
                              {a.price !== null && !ok.simulated && a.priceObservedAt && (
                                <small className="muted price-src">
                                  {(a.priceSource ?? 'price feed').replace(
                                    'chainlink:',
                                    'Chainlink ',
                                  )}{' '}
                                  · feed updated {feedTime(a.priceObservedAt)}
                                </small>
                              )}
                            </td>
                            <td>{a.value === null ? 'Unknown' : `$${a.value}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {w.warnings.map((m) => (
                  <p key={m} className="fine">
                    {m}
                  </p>
                ))}
              </div>
            ))}
            <dl className="track-total">
              <div>
                <dt>Recognized priced subtotal</dt>
                <dd>
                  {ok.totals.recognizedPricedSubtotalUsd === null
                    ? 'Unknown'
                    : `$${ok.totals.recognizedPricedSubtotalUsd}`}
                </dd>
              </div>
              <div>
                <dt>Assets without a price</dt>
                <dd className={ok.totals.unpricedAssetCount > 0 ? 'warn' : undefined}>
                  {ok.totals.unpricedAssetCount}
                </dd>
              </div>
            </dl>
            <p className="fine">{ok.totals.note}</p>
            {ok.warnings.map((m) => (
              <p key={m} className="fine">
                {m}
              </p>
            ))}
            <p className="fine">
              Provider: {ok.provider}. Observed {ok.observedAt}.
            </p>
            {!ok.simulated && (
              <p className="fine">
                Privacy: this lookup sent the address to a public Ethereum node (PublicNode) from
                the app server and read Chainlink USD price feeds through it. PublicNode&apos;s
                published policy says it keeps IP addresses and request data for at most 24 hours;
                that is their statement and is not verified here. Prices are on-chain feed values at
                the time shown on each feed, not market quotes.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
