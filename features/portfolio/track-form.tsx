'use client';
import { useRef, useState } from 'react';
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

export function TrackForm() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function run(raw: string) {
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
            A pasted address is sent to this app&apos;s own lookup service and is not saved in your
            browser. It is observed, not proven to be yours.
          </p>
          {error && (
            <p id="track-error" role="alert" className="fine">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? 'Looking up…' : 'Look up'}
            </button>
          </div>
        </form>
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
      </div>
      <div className="track-output" role="status" aria-live="polite">
        {busy && <p>Looking up…</p>}
        {!busy && !outcome && (
          <p className="fine track-hint">
            Results appear here. Pick a simulated example or paste an address.
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
            <p className="fine addr">Result for the address you looked up: {outcome?.address}</p>
            <ModeMarker
              context="lookup result"
              mode={ok.partial ? 'INCOMPLETE' : ok.simulated ? 'SIMULATED' : 'LIVE_REFRESHED'}
              note={
                ok.simulated
                  ? 'Fixed fixture data from this app. Nothing was read from a blockchain and these are not real balances.'
                  : undefined
              }
            />
            {ok.wallets.map((w) => (
              <div key={w.address}>
                <p className="fine">Address: {w.address}</p>
                {w.assets.length === 0 ? (
                  <p>No assets found for this fixture. An empty wallet is a valid result.</p>
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
                            <td>{a.price === null ? 'Unknown' : `$${a.price}`}</td>
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
            <p className="track-total">
              Recognized priced subtotal:{' '}
              {ok.totals.recognizedPricedSubtotalUsd === null
                ? 'Unknown'
                : `$${ok.totals.recognizedPricedSubtotalUsd}`}
              . Assets without a price: {ok.totals.unpricedAssetCount}.
            </p>
            <p className="fine">{ok.totals.note}</p>
            {ok.warnings.map((m) => (
              <p key={m} className="fine">
                {m}
              </p>
            ))}
            <p className="fine">
              Provider: {ok.provider}. Observed {ok.observedAt}.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
