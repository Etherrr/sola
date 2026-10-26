'use client';
// Real saved-address combined read-only view. On an explicit user action only, reads the
// account's saved addresses and resolves them per network through our own read-only API,
// then runs the reviewed aggregateAddresses model. Never loads automatically; every source
// keeps its own observation time; watched addresses are observed, not proven to be yours.
import Link from 'next/link';
import { evmCoverageLabel, SUPPORTED_EVM_SYMBOLS } from '@/lib/supported-evm-tokens';
import { useEffect, useRef, useState } from 'react';
import { useSession } from './session-context';
import { listAccounts, type AccountsFailure } from './accounts-client';
import { lookupAddresses } from './api-client';
import { aggregateAddresses, type AggregateResult } from './aggregate';
import {
  combinedInputs,
  combinedMode,
  combinedProviders,
  networksWithAccounts,
  type NetworkResults,
} from './combined-load';
import { money, summarize } from './model';
import { differsWhenRounded } from './format';
import { AaveSection } from './aave-section';

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'unavailable'; failure: AccountsFailure }
  | {
      kind: 'ready';
      result: AggregateResult;
      mode: 'live' | 'mock' | 'none';
      providers: string[];
      totalSaved: number;
      loadedAt: string;
    };

const short = (a: string) => (a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);
const clock = (iso: string | null) => (iso === null ? 'n/a' : iso.slice(11, 16) + ' UTC');
const hhmm = (iso: string) => iso.slice(11, 16);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

function accountsFailureText(f: AccountsFailure): string {
  switch (f.kind) {
    case 'signin':
      return 'Your sign-in could not be verified. Sign in again to load saved addresses.';
    case 'off':
      return 'Saved addresses are switched off on this deployment. Nothing was read.';
    case 'storage':
      return 'Account storage is unavailable. Try again later.';
    case 'limited':
      return 'Too many changes. Wait a moment and try again.';
    default:
      return 'Saved addresses could not be read. Nothing was substituted.';
  }
}

export function CombinedWallets() {
  const session = useSession();
  const email = session.kind === 'verified' ? session.email : null;
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(email);
  useEffect(() => {
    emailRef.current = email;
  }, [email]);

  // Identity change or expiry: drop every trace of the previous identity's data BEFORE any
  // fresh paint (render-time adjust pattern, same as the accounts panel).
  const [prevEmail, setPrevEmail] = useState(email);
  if (prevEmail !== email) {
    setPrevEmail(email);
    setPhase({ kind: 'idle' });
    setBusy(false);
  }

  async function onLoad() {
    if (busy || !emailRef.current) return;
    const atEmail = emailRef.current;
    setBusy(true);
    setPhase({ kind: 'loading' });
    const acc = await listAccounts();
    if (emailRef.current !== atEmail) return;
    if (acc.kind !== 'ok') {
      setBusy(false);
      setPhase({ kind: 'unavailable', failure: acc });
      return;
    }
    if (acc.accounts.length === 0) {
      setBusy(false);
      setPhase({ kind: 'empty' });
      return;
    }
    const networks = networksWithAccounts(acc.accounts);
    const results: NetworkResults = {};
    await Promise.all(
      networks.map(async (n) => {
        results[n] = await lookupAddresses(
          n,
          acc.accounts.filter((a) => a.network === n).map((a) => a.address),
        );
      }),
    );
    if (emailRef.current !== atEmail) return;
    const inputs = combinedInputs(acc.accounts, results);
    setBusy(false);
    setPhase({
      kind: 'ready',
      result: aggregateAddresses(inputs),
      mode: combinedMode(results),
      providers: combinedProviders(results),
      totalSaved: acc.accounts.length,
      loadedAt: new Date().toISOString(),
    });
  }

  const ready = phase.kind === 'ready' ? phase : null;
  // Aave V3 sections pass through per address (server includes them only when its flag is
  // on); they are rendered separately and never enter any aggregate above.
  const aaveRows = ready ? ready.result.perAddress.filter((a) => a.aave !== null) : [];
  // Full precision whenever rounding would change a shown Aave digit (same rule as Track).
  const aaveExact = aaveRows.some(
    (a) =>
      a.aave?.status === 'ok' &&
      a.aave.positions.some(
        (pos) =>
          differsWhenRounded(pos.supplied, null, pos.suppliedValueUsd) ||
          differsWhenRounded(pos.variableDebt, null, pos.variableDebtValueUsd),
      ),
  );
  const totals = ready ? summarize(ready.result.positions) : null;
  const totalUnpriced = ready
    ? ready.result.perAddress.reduce((n, a) => n + a.unpricedAssets, 0)
    : 0;
  const unavailable = ready
    ? ready.result.perAddress.filter((a) => a.status === 'failed' || a.status === 'partial').length
    : 0;
  const contributing = ready
    ? ready.result.perAddress.filter((a) => a.pricedValueCents !== null).length
    : 0;
  const mixedSnapshots =
    ready !== null &&
    ready.result.observedRange !== null &&
    ready.result.observedRange.earliest !== ready.result.observedRange.latest;

  return (
    <section className="panel combined" aria-labelledby="combined-h" aria-busy={phase.kind === 'loading'}>
      <span className="badge">
        {ready && ready.mode === 'live'
          ? 'COMBINED VIEW · LIVE READ-ONLY'
          : ready && ready.mode === 'mock'
            ? 'COMBINED VIEW · SIMULATED'
            : 'COMBINED VIEW · READ-ONLY'}
      </span>
      <h2 id="combined-h">Saved addresses, combined</h2>
      <p className="fine muted">Wallet balances only, not net worth.</p>
      {phase.kind === 'idle' ? (
        <>
          <p>
            One combined total from your saved public addresses, loaded only when you ask. What
            this app keeps is under <Link href="/settings">Privacy &amp; local data</Link>.
          </p>
          {session.kind === 'checking' ? (
            <p className="fine muted">Verifying your sign-in…</p>
          ) : email ? (
            <button type="button" className="button primary" onClick={() => void onLoad()}>
              Load saved addresses, combined
            </button>
          ) : (
            <p className="fine muted">
              Your sign-in could not be verified. Sign in to load saved addresses.
            </p>
          )}
        </>
      ) : null}
      {phase.kind === 'loading' ? (
        <p className="fine muted" role="status">
          Reading saved addresses and balances…
        </p>
      ) : null}
      {phase.kind === 'unavailable' ? (
        <>
          <p role="alert">{accountsFailureText(phase.failure)}</p>
          <button type="button" className="button secondary" onClick={() => void onLoad()}>
            Try again
          </button>
        </>
      ) : null}
      {phase.kind === 'empty' ? (
        <p>
          No saved addresses yet. Save public addresses under{' '}
          <Link href="/track">Track</Link>, then load them here.
        </p>
      ) : null}
      {ready && totals ? (
        <div data-sensitive>
          <div className="metric-grid">
            <div className="metric">
              <p>Combined priced value</p>
              {/* n/a, never $0.00, when no address contributed: zero would read as empty wallets. */}
              <strong>{contributing === 0 ? 'n/a' : money(totals.net)}</strong>
              <small>Priced holdings across all saved addresses</small>
              <small>Wallet balances only - not net worth.</small>
              {aaveRows.length > 0 ? (
                <small>
                  Aave V3 positions are listed separately below and are never added to this
                  total.
                </small>
              ) : null}
              {ready.result.incomplete ? (
                <small className="warn-text">
                  Incomplete: {totalUnpriced} unpriced {totalUnpriced === 1 ? 'asset' : 'assets'},{' '}
                  {unavailable} {unavailable === 1 ? 'address' : 'addresses'} partial or failed.
                  Known priced holdings are included; only unknown or unavailable value is
                  excluded.
                </small>
              ) : null}
            </div>
            <div className="metric">
              <p>Addresses combined</p>
              <strong>
                {contributing} of {ready.totalSaved}
              </strong>
              <small>Each address counted once; a duplicate is never a second holding</small>
            </div>
            <div className="metric">
              <p>Balances read</p>
              <strong className="obs-value">
                {(() => {
                  const r = ready.result.observedRange;
                  if (!r) return 'n/a';
                  // Collapse on the FORMATTED label: same-minute reads are one time to the
                  // reader, never "05:58 – 05:58".
                  const a = `${dayLabel(r.earliest)} · ${hhmm(r.earliest)}`;
                  const b = `${dayLabel(r.latest)} · ${hhmm(r.latest)}`;
                  return a === b ? `${a} UTC` : `${a} – ${hhmm(r.latest)} UTC`;
                })()}
              </strong>
              {mixedSnapshots ? <small>Mixed snapshots</small> : null}
            </div>
          </div>
          <div
            className="combined-table-wrap"
            role="region"
            aria-label="Per-address contribution"
            tabIndex={0}
          >
            <table className="combined-table">
              <caption className="fine muted">Per-address contribution (saved addresses)</caption>
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Network</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priced value</th>
                  <th scope="col">Observed</th>
                </tr>
              </thead>
              <tbody>
                {ready.result.perAddress.map((a) => (
                  <tr key={`${a.network}:${a.address}`}>
                    <td data-label="Address">
                      <details className="addr">
                        <summary>
                          {a.label ?? short(a.address)}{' '}
                          <span className="fine muted">{short(a.address)}</span>
                        </summary>
                        <code className="fine">{a.address}</code>
                      </details>
                    </td>
                    <td data-label="Network">{a.network === 'ethereum' ? 'Ethereum' : 'Solana'}</td>
                    <td data-label="Status">
                      {a.status === 'ok' ? (
                        <span className="badge badge-loaded">LOADED</span>
                      ) : (
                        <span className="badge badge-warn">{a.status.toUpperCase()}</span>
                      )}
                    </td>
                    <td data-label="Priced value">
                      {a.pricedValueCents === null ? 'n/a' : money(a.pricedValueCents)}
                      {a.unpricedAssets > 0 ? (
                        <span className="fine muted"> + {a.unpricedAssets} unknown</span>
                      ) : null}
                    </td>
                    <td data-label="Observed">{clock(a.observedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ready.result.perAddress.some((a) => a.status !== 'ok' && a.warnings.length > 0) ? (
            <ul className="fine muted combined-notes">
              {ready.result.perAddress
                .filter((a) => a.status !== 'ok')
                .map((a) => (
                  <li key={`w-${a.network}:${a.address}`}>
                    {a.label ?? short(a.address)}: {a.warnings[0]}
                  </li>
                ))}
            </ul>
          ) : null}
          <div className="combined-coverage">
            <span className="cov-badge">Ethereum: {SUPPORTED_EVM_SYMBOLS.join(', ')}</span>
            <span className="cov-badge">Solana: SOL balance only</span>
            <span className="cov-badge">Observed, not owned</span>
            {ready.result.priceAsOf ? (
              <span className="cov-badge">
                Prices {dayLabel(ready.result.priceAsOf)} · {hhmm(ready.result.priceAsOf)} UTC
              </span>
            ) : null}
            <details className="cov-details">
              <summary>Coverage details</summary>
          <ul className="fine muted combined-notes">
            <li>
              Coverage: Ethereum {evmCoverageLabel()}; Solana SOL balance only. A missing token
              is not a zero balance.
            </li>
            <li>
              Only values read at each source&apos;s own observation time are included; nothing
              is back-filled from older or last-known snapshots.
            </li>
            {aaveRows.length > 0 ? (
              <li>
                Aave V3 (Ethereum): supplied and variable-debt positions only, listed per
                address below; never added to wallet balances or the combined total.
              </li>
            ) : null}
            <li>Refreshes only when you ask. No alerts, no automatic updates.</li>
            {ready.providers.length > 0 ? (
              <li>Sources: {ready.providers.join(', ')} via the read-only API.</li>
            ) : null}
          </ul>
            </details>
          </div>
          {aaveRows.length > 0 ? (
            <div className="combined-aave">
              {aaveRows.map((a) => (
                <div key={`aave-${a.network}:${a.address}`}>
                  <p className="fine muted">
                    {a.label ?? short(a.address)}{' '}
                    <span className="fine muted">{short(a.address)}</span> - listed separately,
                    never added to the combined total
                  </p>
                  <p className="fine muted ab-lookup-pan-hint">
                    Scroll sideways for debt and observed time.
                  </p>
                  {a.aave ? <AaveSection section={a.aave} exact={aaveExact} /> : null}
                </div>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void onLoad()}
          >
            Refresh now
          </button>
        </div>
      ) : null}
    </section>
  );
}
