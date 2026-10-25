import type { ApiAaveSection } from './api-client';
import { fmtAmount, fmtUsd } from './format';

const feedTime = (iso: string) => iso.slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * The Aave V3 positions block of one wallet's lookup result. Rendered only when the server
 * sent the section; its three states are honest: real positions, a true empty, or unavailable.
 */
export function AaveSection({ section, exact }: { section: ApiAaveSection; exact: boolean }) {
  return (
    <section className="aave-section" aria-label="Aave V3 positions (Ethereum)">
      <h3>Aave V3 positions (Ethereum)</h3>
      <p className="fine">
        Supplied and variable-debt balances on Aave V3 (Ethereum) only. No stable debt, health
        factor, APY, or other protocols. A missing position is not a zero.
      </p>
      {section.status === 'unavailable' ? (
        <p>
          Aave positions could not be read. Nothing was substituted.
          {section.reason === 'rate_limited'
            ? ' The data source is rate limiting; try again later. There is no automatic retry.'
            : ''}
        </p>
      ) : section.positions.length === 0 ? (
        <p>
          No supplied or variable-debt positions were found on Aave V3 (Ethereum) for this
          address. Other protocols were not checked.
        </p>
      ) : (
        <>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Aave V3 positions table, scrolls sideways when it is wider than the screen"
            onFocus={(e) => {
              // Same corrective alignment as the wallet balances table.
              const el = e.currentTarget;
              window.setTimeout(() => {
                el.scrollIntoView({ block: 'start', behavior: 'auto' });
              }, 0);
            }}
          >
            <table className="track-table" role="table">
              <caption>
                Aave V3 positions (Ethereum). Balances at each reserve&apos;s stored index time;
                USD values only from this app&apos;s own verified feeds.
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Asset
                  </th>
                  <th scope="col" role="columnheader">
                    Supplied
                  </th>
                  <th scope="col" role="columnheader">
                    Variable debt
                  </th>
                  <th scope="col" role="columnheader">
                    Observed
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {section.positions.map((p) => (
                  <tr key={p.underlyingAsset} role="row">
                    <th scope="row" role="rowheader">
                      {p.symbol}
                      {p.usageAsCollateralEnabled && (
                        <small className="muted"> usable as collateral</small>
                      )}
                      {p.reserveNote && <small className="muted warn"> {p.reserveNote}</small>}
                    </th>
                    <td role="cell" className="t-amount" data-unit={p.symbol}>
                      {fmtAmount(p.supplied, exact)}
                      <small className="muted price-src">
                        {p.suppliedValueUsd === null
                          ? 'value Unknown'
                          : fmtUsd(p.suppliedValueUsd, exact)}
                      </small>
                    </td>
                    <td role="cell" className="t-amount" data-unit={p.symbol}>
                      {fmtAmount(p.variableDebt, exact)}
                      <small className="muted price-src">
                        {p.variableDebtValueUsd === null
                          ? 'value Unknown'
                          : fmtUsd(p.variableDebtValueUsd, exact)}
                      </small>
                    </td>
                    <td role="cell" className="t-price">
                      <small className="muted price-src">
                        reserve stored index time {feedTime(p.observedAt)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">
            Values cover only assets priced by this app&apos;s own verified feeds; anything else
            is named with its value unknown. These positions are not your total account value.
          </p>
        </>
      )}
    </section>
  );
}
