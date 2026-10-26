'use client';
// Plan 6.2 Assets: unified recorded holdings - searchable, sortable, with
// category filters. Supplied balances are protocol positions (kind marker),
// never an extra balance. Unknown prices/values render as Unknown; the
// Investments and NFTs filters show an explicit not-covered state instead of
// an empty table that would read as "you own none".
import { useMemo, useState } from 'react';
import { fetchAssets, usePortfolioView } from './views-client';
import { StateBlock, Caveats } from './views-shared';
import { fmtTimestamp } from './format-time';
import { amount, cmpDecimal, pct, price, usd } from './view-format';

type Filter = 'all' | 'spot' | 'supplied' | 'investments' | 'nfts';
type Sort = 'value' | 'amount' | 'symbol';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'spot', label: 'Spot' },
  { id: 'supplied', label: 'Supplied' },
  { id: 'investments', label: 'Investments' },
  { id: 'nfts', label: 'NFTs' },
];

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function AssetsView() {
  const { status, data, retry } = usePortfolioView('assets', fetchAssets);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('value');
  const [query, setQuery] = useState('');

  // The wire's assets view includes recorded DEBT rows. A liability is not a
  // holding and never belongs in an allocation column: split it out and render
  // it separately, labeled, with no share-of-priced figure (ratios live on the
  // Risk & Return page). The holdings count excludes debt rows.
  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows.filter((x) => x.kind !== 'protocol_debt');
    if (filter === 'spot') r = r.filter((x) => x.kind === 'wallet_balance');
    if (filter === 'supplied') r = r.filter((x) => x.kind === 'protocol_supplied');
    const q = query.trim().toLowerCase();
    if (q)
      r = r.filter(
        (x) =>
          x.symbol.toLowerCase().includes(q) ||
          x.address.toLowerCase().includes(q) ||
          x.assetId.toLowerCase().includes(q),
      );
    // Decimal-string compares only - wire values never pass through floats.
    const unpricedLast = (v: string | null) => (v === null ? '-1' : v);
    const by: Record<Sort, (a: (typeof r)[number], b: (typeof r)[number]) => number> = {
      value: (a, b) => cmpDecimal(unpricedLast(b.valueUsd), unpricedLast(a.valueUsd)),
      amount: (a, b) => cmpDecimal(b.amount, a.amount),
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    return [...r].sort(by[sort]);
  }, [data, filter, sort, query]);

  if (status.kind === 'loading') return <p className="muted">Loading recorded holdings…</p>;
  if (status.kind !== 'ok' && status.kind !== 'empty')
    return (
      <div>
        <StateBlock kind={status.kind} />
        {status.kind === 'failed' && (
          <button type="button" className="btn ghost" onClick={retry}>
            Retry
          </button>
        )}
      </div>
    );
  if (status.kind === 'empty')
    return (
      <div>
        <StateBlock kind="empty" reason={status.reason} />
        <Caveats
          membership={status.recordedRunMembership}
          newerPartial={status.newerPartial}
          newerUnattributed={status.newerUnattributed}
        />
      </div>
    );
  if (!data) return null;

  return (
    <div>
      <p className="muted">
        Recorded {fmtTimestamp(data.at)} · {data.rows.filter((x) => x.kind !== 'protocol_debt').length} holding
        {data.rows.filter((x) => x.kind !== 'protocol_debt').length === 1 ? '' : 's'}
      </p>
      <Caveats
        membership={data.recordedRunMembership}
        newerPartial={data.newerPartial}
        newerUnattributed={data.newerUnattributed}
      />
      <div className="view-controls">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip${filter === f.id ? ' on' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <input
          className="view-search"
          type="search"
          placeholder="Search symbol or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search holdings"
        />
        <select
          className="view-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort holdings"
        >
          <option value="value">Sort: value</option>
          <option value="amount">Sort: amount</option>
          <option value="symbol">Sort: symbol</option>
        </select>
      </div>
      {(filter === 'investments' || filter === 'nfts') && (
        <p className="muted">
          {filter === 'investments' ? 'Investments' : 'NFTs'} are not covered by recorded
          observations yet - nothing is invented for this category.
        </p>
      )}
      {filter !== 'investments' && filter !== 'nfts' && rows.length === 0 && (
        <p className="muted">No recorded holdings match this filter.</p>
      )}
      {filter !== 'investments' && filter !== 'nfts' && rows.length > 0 && (
        <table className="ov2-holdings-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Network</th>
              <th>Wallet</th>
              <th className="num">Amount</th>
              <th className="num">Price</th>
              <th className="num">Value</th>
              <th className="num">Share of priced</th>
              <th>Observed</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.assetId}|${r.network}|${r.address}|${r.kind}`}>
                <td data-label="Asset" title={r.assetId}>
                  {r.symbol}
                  {r.kind === 'protocol_supplied' && <span className="tag">supplied</span>}
                  {r.kind === 'protocol_debt' && <span className="tag">debt</span>}
                </td>
                <td data-label="Network">{r.network}</td>
                <td data-label="Wallet" title={r.address}>{short(r.address)}</td>
                <td data-label="Amount" className="num" title={r.amount}>
                  {amount(r.amount)}
                </td>
                <td data-label="Price" className="num" title={r.priceUsd ?? undefined}>
                  {price(r.priceUsd)}
                  {r.priceStale && r.priceUsd !== null && <span className="tag">stale</span>}
                </td>
                <td data-label="Value" className="num" title={r.valueUsd ?? undefined}>
                  {usd(r.valueUsd)}
                </td>
                <td data-label="Share of priced" className="num">{pct(r.shareOfPricedPct)}</td>
                <td data-label="Observed" title={r.observedAt}>{fmtTimestamp(r.observedAt)}</td>
                <td data-label="Source">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.rows.some((x) => x.kind === 'protocol_debt') && (
        <section className="panel">
          <h2>Recorded debt</h2>
          <p className="muted caveat">
            Debt is a liability, not an allocation - no share-of-priced figure is shown here.
            Debt ratios live on the Risk &amp; Return page.
          </p>
          <table className="ov2-holdings-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Network</th>
                <th className="num">Amount</th>
                <th className="num">Value</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {data.rows
                .filter((x) => x.kind === 'protocol_debt')
                .map((r) => (
                  <tr key={`${r.assetId}|${r.network}|${r.address}|debt`}>
                    <td data-label="Asset" title={r.assetId}>
                      {r.symbol}
                      <span className="tag">debt</span>
                    </td>
                    <td data-label="Network">{r.network}</td>
                    <td data-label="Amount" className="num" title={r.amount}>
                      {amount(r.amount)}
                    </td>
                    <td data-label="Value" className="num" title={r.valueUsd ?? undefined}>
                      {usd(r.valueUsd)}
                    </td>
                    <td data-label="Observed" title={r.observedAt}>
                      {fmtTimestamp(r.observedAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
