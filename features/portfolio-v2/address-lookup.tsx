'use client';
import { useEffect, useRef, useState } from 'react';
import {
  lookupAddress,
  type ApiSuccess,
  type LookupOutcome,
  type TrackNetwork,
} from '../portfolio/api-client';
import { fmtTimestamp, feedTimeUTC } from './format-time';
import { differsWhenRounded, fmtPrice, fmtUsd } from '../portfolio/format';
import { AaveSection } from '../portfolio/aave-section';

/**
 * v0.2 "Look up an address" - the on-demand single-address lookup the plan
 * keeps as a tool inside Addresses & Wallets (plan line 54), replacing the
 * disconnected Track page. Same normalized row shape and table markup as the
 * recorded holdings (Asset / Network / Amount), so figures read the same
 * everywhere; clearly labeled as an ON-DEMAND lookup (simulated or live,
 * with the provider's own observation time), never as recorded history.
 * The privacy disclosure sits next to the action, once (plan line 177) -
 * not repeated on every screen.
 */

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Chain-aware shape detection; returns null when neither network fits. */
export function detectNetwork(input: string): TrackNetwork | null {
  const a = input.trim();
  if (EVM_ADDR.test(a)) return 'ethereum';
  if (SOL_ADDR.test(a)) return 'solana';
  return null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string; retryAfterSeconds?: number }
  | { kind: 'ok'; data: ApiSuccess; network: TrackNetwork };

export function AddressLookup() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const generation = useRef(0);
  useEffect(() => () => {
    generation.current++;
  }, []);

  const detected = detectNetwork(value);

  const onChange = (next: string) => {
    setValue(next);
    // A shown result belongs to the address it was fetched for; editing the
    // input clears it so stale balances never sit beside a different address.
    setState((s) => (s.kind === 'ok' || s.kind === 'error' ? { kind: 'idle' } : s));
  };

  const run = async () => {
    const network = detectNetwork(value);
    if (!network || state.kind === 'busy') return;
    const g = ++generation.current;
    setState({ kind: 'busy' });
    const outcome: LookupOutcome = await lookupAddress(value.trim(), network);
    if (generation.current !== g) return; // superseded or unmounted
    if (outcome.kind === 'ok') setState({ kind: 'ok', data: outcome.data, network });
    else
      setState({
        kind: 'error',
        message: outcome.message,
        ...(outcome.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: outcome.retryAfterSeconds }
          : {}),
      });
  };

  const wallet = state.kind === 'ok' ? state.data.wallets[0] : null;
  // Show full precision whenever rounding would change a shown digit (Track rule).
  const exact =
    state.kind === 'ok' &&
    (state.data.wallets.some(
      (w) =>
        w.assets.some((a) => differsWhenRounded(a.amount, a.price, a.value)) ||
        (w.aave?.status === 'ok' &&
          w.aave.positions.some(
            (pos) =>
              differsWhenRounded(pos.supplied, null, pos.suppliedValueUsd) ||
              differsWhenRounded(pos.variableDebt, null, pos.variableDebtValueUsd),
          )),
    ) ||
      (state.data.totals.recognizedPricedSubtotalUsd !== null &&
        fmtUsd(state.data.totals.recognizedPricedSubtotalUsd, true) !==
          fmtUsd(state.data.totals.recognizedPricedSubtotalUsd, false)));

  return (
    <div className="accounts ab-lookup">
      <h3>Look up an address</h3>
      <p className="ov2-quiet">
        A lookup sends the address you enter to third-party blockchain data providers. Nothing is
        saved unless you add the address above.
      </p>
      <div className="ab-lookup-form">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0x… or Solana address"
          aria-label="Address to look up"
          disabled={state.kind === 'busy'}
        />
        <button
          type="button"
          className="button primary"
          onClick={() => void run()}
          disabled={!detected || state.kind === 'busy'}
        >
          {state.kind === 'busy' ? 'Looking up…' : 'Look up'}
        </button>
      </div>
      {value.trim() !== '' && !detected && (
        <p><em>That address does not look like an EVM or Solana address.</em></p>
      )}
      {state.kind === 'error' && (
        <p><em>
          {state.message}
          {state.retryAfterSeconds !== undefined
            ? ` Retry in about ${state.retryAfterSeconds}s.`
            : ''}
        </em></p>
      )}
      {state.kind === 'ok' && wallet && (
        <>
          <p>
            Balances for <code>{shortAddr(wallet.address)}</code> on{' '}
            {state.network === 'ethereum' ? 'EVM' : 'Solana'}:
          </p>
          <table>
            <thead>
              <tr><th>Asset</th><th>Network</th><th>Amount</th><th>Price (USD)</th><th>Value (USD)</th></tr>
            </thead>
            <tbody>
              {wallet.assets.map((a) => (
                <tr key={a.assetId}>
                  <td data-label="Asset" title={a.assetId}>{a.symbol}</td>
                  <td data-label="Network">{state.network === 'ethereum' ? 'EVM' : 'Solana'}</td>
                  <td data-label="Amount">{a.amount}</td>
                  <td data-label="Price (USD)">
                    {a.price === null ? 'Unknown' : fmtPrice(a.price, exact)}
                    {a.price !== null && !state.data.simulated && a.priceObservedAt && (
                      <small className="muted">
                        {' '}
                        {(a.priceSource ?? 'price feed').replace('chainlink:', 'Chainlink ')}
                        {' · feed updated '}
                        <span title={a.priceObservedAt}>{feedTimeUTC(a.priceObservedAt)}</span>
                      </small>
                    )}
                  </td>
                  <td data-label="Value (USD)">
                    {a.value === null ? 'Unknown' : fmtUsd(a.value, exact)}
                  </td>
                </tr>
              ))}
              {wallet.assets.length === 0 && (
                <tr><td colSpan={5}><em>
                  {state.data.partial || state.data.warnings.length > 0
                    ? 'No balances returned - the answer is incomplete, so balances are unknown.'
                    : 'No balances returned for this address.'}
                </em></td></tr>
              )}
            </tbody>
          </table>
          {wallet.aave && (
            <>
              <p className="ov2-quiet ab-lookup-pan-hint">
                Scroll sideways for debt and observed time.
              </p>
              <AaveSection section={wallet.aave} exact={exact} />
            </>
          )}
          <p className="ov2-quiet">
            Recognized priced subtotal:{' '}
            {state.data.totals.recognizedPricedSubtotalUsd === null
              ? 'Unknown'
              : fmtUsd(state.data.totals.recognizedPricedSubtotalUsd, exact)}
            {state.data.totals.unpricedAssetCount > 0
              ? ` · ${state.data.totals.unpricedAssetCount} ${
                  state.data.totals.unpricedAssetCount === 1 ? 'asset' : 'assets'
                } without a price`
              : ''}
          </p>
          {state.data.totals.note ? (
            <p className="ov2-quiet">{state.data.totals.note}</p>
          ) : null}
          <p><em>
            On-demand lookup{state.data.simulated ? ' (simulated)' : ''} as of{' '}
            <span title={state.data.observedAt}>{fmtTimestamp(state.data.observedAt)}</span>. Not a recorded observation.
            {state.network === 'solana' ? ' Solana lookups show the SOL balance only.' : ''}
            {state.data.partial ? ' Some sources did not answer - figures may be incomplete.' : ''}
            {state.data.warnings.length > 0 ? ` ${state.data.warnings.join('; ')}.` : ''}
          </em></p>
        </>
      )}
    </div>
  );
}
