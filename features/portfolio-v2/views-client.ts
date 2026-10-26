'use client';
// Plan 6.2-6.4: client mapping for the recorded Assets / DeFi / Risk views.
// The same honest-state contract as the Overview v2: shape is validated
// before anything renders; a malformed payload fails closed. Empty
// responses tolerate a MISSING recorded-run marker (the server only sends
// it on ok and on no_holdings_recorded); ok responses require it - 'exact'
// means recorded-run membership only, and an unknown marker never renders
// data it cannot vouch for.
import { useEffect, useRef, useState } from 'react';
import { portfolioViewRequest } from '../portfolio/api-client';

export type RecordedRunMembership = 'exact' | 'best_effort_legacy' | null;
export type ViewKind = 'assets' | 'positions' | 'risk';

// Real wire (position-history.ts): per-network entries carry the network and
// its latest observation time ONLY - no address field exists on this wire.
export type ViewNetwork = {
  network: string;
  latestObservedAt: string;
};

// Wire values are DECIMAL STRINGS end to end (BigInt-safe; floats never
// enter). Formatting lives in view-format / portfolio/format.
export type AssetRow = {
  assetId: string;
  symbol: string;
  network: string;
  address: string;
  kind: 'wallet_balance' | 'protocol_supplied' | 'protocol_debt';
  amount: string;
  priceUsd: string | null;
  valueUsd: string | null;
  shareOfPricedPct: string | null;
  observedAt: string;
  source: string;
  priceStale: boolean;
};

export type PositionRow = {
  protocol: string;
  network: string;
  address: string;
  assetId: string;
  symbol: string;
  supplied: string;
  debt: string;
  net: string;
  suppliedValueUsd: string | null;
  debtValueUsd: string | null;
  priceStale: boolean;
  observedAt: string;
};

export type ConcentrationRow = { label: string; valueUsd: string; sharePct: string };

export type RiskView = {
  byChain: ConcentrationRow[];
  byAsset: ConcentrationRow[];
  byProtocol: ConcentrationRow[];
  /** known debt / known priced assets as a 4dp RATIO string; null when no priced assets. */
  debtToKnownAssets: string | null;
  /** Percent string (2dp), already multiplied by 100 server-side. */
  stablecoinSharePct: string | null;
  partial: boolean;
};

export type ViewOk = {
  kind: 'ok';
  at: string;
  newerPartial: boolean;
  newerUnattributed: boolean;
  recordedRunMembership: RecordedRunMembership;
  networks: ViewNetwork[];
};

export type AssetsResult =
  | (ViewOk & { rows: AssetRow[] })
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' };

export type PositionsResult =
  | (ViewOk & { rows: PositionRow[] })
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' };

export type RiskResult =
  | (ViewOk & { risk: RiskView })
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' };

const MEMBERS: RecordedRunMembership[] = ['exact', 'best_effort_legacy', null];
const member = (v: unknown): RecordedRunMembership | undefined =>
  MEMBERS.includes(v as RecordedRunMembership) ? (v as RecordedRunMembership) : undefined;

const net = (v: unknown): ViewNetwork | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.network !== 'string' || typeof o.latestObservedAt !== 'string') return null;
  return { network: o.network, latestObservedAt: o.latestObservedAt };
};

const DEC = /^-?\d+(\.\d+)?$/;
const dec = (v: unknown) => (typeof v === 'string' && DEC.test(v) ? v : undefined);
// Nullable decimal: null is a real wire value (Unknown); a WRONG TYPE (number,
// junk string, missing key) is malformed and must fail closed, not read as null.
const decOrNull = (v: unknown): string | null | undefined => (v === null ? null : dec(v));

const assetRow = (v: unknown): AssetRow | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.assetId !== 'string' ||
    typeof o.symbol !== 'string' ||
    typeof o.network !== 'string' ||
    typeof o.address !== 'string' ||
    (o.kind !== 'wallet_balance' && o.kind !== 'protocol_supplied' && o.kind !== 'protocol_debt') ||
    dec(o.amount) === undefined ||
    decOrNull(o.priceUsd) === undefined ||
    decOrNull(o.valueUsd) === undefined ||
    decOrNull(o.shareOfPricedPct) === undefined ||
    typeof o.observedAt !== 'string' ||
    typeof o.source !== 'string' ||
    typeof o.priceStale !== 'boolean'
  )
    return null;
  return {
    assetId: o.assetId,
    symbol: o.symbol,
    network: o.network,
    address: o.address,
    kind: o.kind,
    amount: o.amount as string,
    priceUsd: decOrNull(o.priceUsd) as string | null,
    valueUsd: decOrNull(o.valueUsd) as string | null,
    shareOfPricedPct: decOrNull(o.shareOfPricedPct) as string | null,
    observedAt: o.observedAt,
    source: o.source,
    priceStale: o.priceStale as boolean,
  };
};

const positionRow = (v: unknown): PositionRow | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.protocol !== 'string' ||
    typeof o.network !== 'string' ||
    typeof o.address !== 'string' ||
    typeof o.assetId !== 'string' ||
    typeof o.symbol !== 'string' ||
    dec(o.supplied) === undefined ||
    dec(o.debt) === undefined ||
    dec(o.net) === undefined ||
    decOrNull(o.suppliedValueUsd) === undefined ||
    decOrNull(o.debtValueUsd) === undefined ||
    typeof o.observedAt !== 'string' ||
    typeof o.priceStale !== 'boolean'
  )
    return null;
  return {
    protocol: o.protocol,
    network: o.network,
    address: o.address,
    assetId: o.assetId,
    symbol: o.symbol,
    supplied: o.supplied as string,
    debt: o.debt as string,
    net: o.net as string,
    suppliedValueUsd: decOrNull(o.suppliedValueUsd) as string | null,
    debtValueUsd: decOrNull(o.debtValueUsd) as string | null,
    priceStale: o.priceStale as boolean,
    observedAt: o.observedAt,
  };
};

const conc = (v: unknown): ConcentrationRow | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.label !== 'string' || dec(o.sharePct) === undefined || dec(o.valueUsd) === undefined)
    return null;
  return { label: o.label, sharePct: o.sharePct as string, valueUsd: o.valueUsd as string };
};

const concList = (v: unknown): ConcentrationRow[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map(conc);
  return out.some((r) => r === null) ? null : (out as ConcentrationRow[]);
};

const riskView = (v: unknown): RiskView | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const byChain = concList(o.byChain);
  const byAsset = concList(o.byAsset);
  const byProtocol = concList(o.byProtocol);
  if (!byChain || !byAsset || !byProtocol || typeof o.partial !== 'boolean') return null;
  if (decOrNull(o.debtToKnownAssets) === undefined || decOrNull(o.stablecoinSharePct) === undefined)
    return null;
  // Coverage/staleness flags never default to the reassuring value on a broken
  // payload: a missing or non-boolean `partial` fails closed. (newerPartial /
  // newerUnattributed keep `=== true` - the approved overview mapping precedent,
  // where absent means "no newer signal to report".)
  return {
    byChain,
    byAsset,
    byProtocol,
    debtToKnownAssets: decOrNull(o.debtToKnownAssets) as string | null,
    stablecoinSharePct: decOrNull(o.stablecoinSharePct) as string | null,
    partial: o.partial as boolean,
  };
};

type Parsed =
  | {
      kind: 'ok';
      at: string;
      newerPartial: boolean;
      newerUnattributed: boolean;
      recordedRunMembership: RecordedRunMembership;
      networks: ViewNetwork[];
      body: Record<string, unknown>;
    }
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' };

const parse = async (res: Response): Promise<Parsed> => {
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 403) return { kind: 'notinvited' };
  if (res.status === 503) return { kind: 'off' };
  if (!res.ok) return { kind: 'failed' };
  let j: unknown;
  try {
    j = await res.json();
  } catch {
    return { kind: 'failed' };
  }
  if (!j || typeof j !== 'object') return { kind: 'failed' };
  const o = j as Record<string, unknown>;
  const newerPartial = o.newerPartial === true;
  const newerUnattributed = o.newerUnattributed === true;
  if (o.status === 'empty') {
    // Marker is optional on empty payloads (absent on no_recorded_observations) -
    // tolerate its absence, but never reinterpret a present-but-unknown value.
    const m = 'recordedRunMembership' in o ? member(o.recordedRunMembership) : null;
    if (m === undefined) return { kind: 'failed' };
    if (o.reason === 'no_recorded_observations' || o.reason === 'no_holdings_recorded')
      return { kind: 'empty', reason: o.reason, newerPartial, newerUnattributed, recordedRunMembership: m };
    return { kind: 'failed' };
  }
  if (o.status === 'ok') {
    if (typeof o.latestCompleteObservedAt !== 'string') return { kind: 'failed' };
    const m = member(o.recordedRunMembership);
    if (m === undefined) return { kind: 'failed' };
    const networks = Array.isArray(o.networks) ? o.networks.map(net) : null;
    if (!networks || networks.some((n) => n === null)) return { kind: 'failed' };
    return {
      kind: 'ok',
      at: o.latestCompleteObservedAt,
      newerPartial,
      newerUnattributed,
      recordedRunMembership: m,
      networks: networks as ViewNetwork[],
      body: o,
    };
  }
  return { kind: 'failed' };
};

export async function fetchAssets(signal?: AbortSignal): Promise<AssetsResult> {
  let p: Parsed;
  try {
    p = await parse(await portfolioViewRequest('assets', signal));
  } catch {
    return { kind: 'failed' };
  }
  if (p.kind !== 'ok') return p;
  const rows = Array.isArray(p.body.rows) ? p.body.rows.map(assetRow) : null;
  if (!rows || rows.some((r) => r === null)) return { kind: 'failed' };
  return {
    kind: 'ok',
    at: p.at,
    newerPartial: p.newerPartial,
    newerUnattributed: p.newerUnattributed,
    recordedRunMembership: p.recordedRunMembership,
    networks: p.networks,
    rows: rows as AssetRow[],
  };
}

export async function fetchPositions(signal?: AbortSignal): Promise<PositionsResult> {
  let p: Parsed;
  try {
    p = await parse(await portfolioViewRequest('positions', signal));
  } catch {
    return { kind: 'failed' };
  }
  if (p.kind !== 'ok') return p;
  const rows = Array.isArray(p.body.rows) ? p.body.rows.map(positionRow) : null;
  if (!rows || rows.some((r) => r === null)) return { kind: 'failed' };
  return {
    kind: 'ok',
    at: p.at,
    newerPartial: p.newerPartial,
    newerUnattributed: p.newerUnattributed,
    recordedRunMembership: p.recordedRunMembership,
    networks: p.networks,
    rows: rows as PositionRow[],
  };
}

export async function fetchRisk(signal?: AbortSignal): Promise<RiskResult> {
  let p: Parsed;
  try {
    p = await parse(await portfolioViewRequest('risk', signal));
  } catch {
    return { kind: 'failed' };
  }
  if (p.kind !== 'ok') return p;
  const risk = riskView(p.body.risk);
  if (!risk) return { kind: 'failed' };
  return {
    kind: 'ok',
    at: p.at,
    newerPartial: p.newerPartial,
    newerUnattributed: p.newerUnattributed,
    recordedRunMembership: p.recordedRunMembership,
    networks: p.networks,
    risk,
  };
}

export type ViewStatus =
  | { kind: 'loading' }
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' }
  | (ViewOk & { loaded: true });

/** Generation-guarded fetch for one recorded view; `load` turns the raw
 *  response into the view's result. Same pattern as holdings-table: a late
 *  response from a superseded attempt is discarded, never repainted. */
export function usePortfolioView<T extends { kind: string }>(
  view: ViewKind,
  load: (signal?: AbortSignal) => Promise<T>,
): { status: ViewStatus; data: (T & ViewOk) | null; retry: () => void } {
  const [result, setResult] = useState<T | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const gen = useRef(0);
  useEffect(() => {
    const g = ++gen.current;
    const ctl = new AbortController();
    load(ctl.signal).then((r) => {
      if (gen.current === g) setResult(r);
    });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, retryTick]);
  const retry = () => setRetryTick((t) => t + 1);
  if (!result) return { status: { kind: 'loading' }, data: null, retry };
  if (result.kind === 'ok')
    return { status: { ...(result as unknown as ViewOk), loaded: true }, data: result as T & ViewOk, retry };
  return { status: result as ViewStatus, data: null, retry };
}

/* ---------- Overview view (plan 6.1, reviewer binding verdict A1-A5 + PIN1-3) ---------- */

export type OverviewTotals = {
  assetRowCount: number;
  /** null = UNKNOWN (asset rows exist, none usable-priced) - never render $0. */
  grossPricedUsd: string | null;
  grossPartial: boolean;
  unpricedAssetCount: number;
  staleAssetCount: number;
  debtState: 'none' | 'priced' | 'partially_unknown';
  recordedDebtUsd: string | null;
  /** Present only when computable; renders ONLY under "Net of recorded debt"
   *  with the "(known priced assets only)" qualifier when netPartial. */
  netUsd: string | null;
  netPartial: boolean;
};

export type HistoryPoint = {
  /** Points key by RUN ID, never by instant (PIN3). */
  runId: string;
  requestedAt: string;
  observedAt: string;
  pricedSubtotalUsd: string;
  unpricedCount: number;
  staleCount: number;
  legacy: boolean;
};

export type HistorySeries = { network: string; points: HistoryPoint[] };

export type OverviewResult =
  | (ViewOk & { totals: OverviewTotals; allocation: { byNetwork: ConcentrationRow[]; byCategory: ConcentrationRow[] }; history: HistorySeries[] })
  | { kind: 'empty'; reason: 'no_recorded_observations' | 'no_holdings_recorded'; newerPartial: boolean; newerUnattributed: boolean; recordedRunMembership: RecordedRunMembership; history: HistorySeries[] | null }
  | { kind: 'signin' | 'notinvited' | 'off' | 'failed' };

const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

const totals = (v: unknown): OverviewTotals | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // Fail-closed: counts and booleans never default to the reassuring value.
  if (
    count(o.assetRowCount) === undefined ||
    decOrNull(o.grossPricedUsd) === undefined ||
    typeof o.grossPartial !== 'boolean' ||
    count(o.unpricedAssetCount) === undefined ||
    count(o.staleAssetCount) === undefined ||
    (o.debtState !== 'none' && o.debtState !== 'priced' && o.debtState !== 'partially_unknown') ||
    decOrNull(o.recordedDebtUsd) === undefined ||
    decOrNull(o.netUsd) === undefined ||
    typeof o.netPartial !== 'boolean'
  )
    return null;
  return {
    assetRowCount: o.assetRowCount as number,
    grossPricedUsd: decOrNull(o.grossPricedUsd) as string | null,
    grossPartial: o.grossPartial as boolean,
    unpricedAssetCount: o.unpricedAssetCount as number,
    staleAssetCount: o.staleAssetCount as number,
    debtState: o.debtState,
    recordedDebtUsd: decOrNull(o.recordedDebtUsd) as string | null,
    netUsd: decOrNull(o.netUsd) as string | null,
    netPartial: o.netPartial as boolean,
  };
};

const historyPoint = (v: unknown): HistoryPoint | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.runId !== 'string' ||
    typeof o.requestedAt !== 'string' ||
    typeof o.observedAt !== 'string' ||
    dec(o.pricedSubtotalUsd) === undefined ||
    count(o.unpricedCount) === undefined ||
    count(o.staleCount) === undefined ||
    typeof o.legacy !== 'boolean'
  )
    return null;
  return {
    runId: o.runId,
    requestedAt: o.requestedAt,
    observedAt: o.observedAt,
    pricedSubtotalUsd: o.pricedSubtotalUsd as string,
    unpricedCount: o.unpricedCount as number,
    staleCount: o.staleCount as number,
    legacy: o.legacy as boolean,
  };
};

const history = (v: unknown): HistorySeries[] | null => {
  if (!Array.isArray(v)) return null;
  const out: HistorySeries[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (typeof o.network !== 'string' || !Array.isArray(o.points)) return null;
    const pts = o.points.map(historyPoint);
    if (pts.some((p) => p === null)) return null;
    out.push({ network: o.network, points: pts as HistoryPoint[] });
  }
  return out;
};

/** GET the recorded Overview. Unlike the other views, the no_holdings_recorded
 *  empty state CARRIES history (A1: earlier runs stay visible and a complete
 *  zero-row run plots at 0), so this view parses that branch itself. */
export async function fetchOverviewView(signal?: AbortSignal): Promise<OverviewResult> {
  let res: Response;
  try {
    res = await portfolioViewRequest('overview', signal);
  } catch {
    return { kind: 'failed' };
  }
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 403) return { kind: 'notinvited' };
  if (res.status === 503) return { kind: 'off' };
  if (!res.ok) return { kind: 'failed' };
  let j: unknown;
  try {
    j = await res.json();
  } catch {
    return { kind: 'failed' };
  }
  if (!j || typeof j !== 'object') return { kind: 'failed' };
  const o = j as Record<string, unknown>;
  const newerPartial = o.newerPartial === true;
  const newerUnattributed = o.newerUnattributed === true;
  if (o.status === 'empty') {
    const m = 'recordedRunMembership' in o ? member(o.recordedRunMembership) : null;
    if (m === undefined) return { kind: 'failed' };
    if (o.reason === 'no_recorded_observations')
      return { kind: 'empty', reason: o.reason, newerPartial, newerUnattributed, recordedRunMembership: m, history: null };
    if (o.reason === 'no_holdings_recorded') {
      const h = history(o.history);
      if (!h) return { kind: 'failed' }; // zero-row history must be served intact
      return { kind: 'empty', reason: o.reason, newerPartial, newerUnattributed, recordedRunMembership: m, history: h };
    }
    return { kind: 'failed' };
  }
  if (o.status !== 'ok') return { kind: 'failed' };
  if (typeof o.latestCompleteObservedAt !== 'string') return { kind: 'failed' };
  const m = member(o.recordedRunMembership);
  if (m === undefined) return { kind: 'failed' };
  const networks = Array.isArray(o.networks) ? o.networks.map(net) : null;
  if (!networks || networks.some((n) => n === null)) return { kind: 'failed' };
  const t = totals(o.totals);
  const h = history(o.history);
  const alloc = o.allocation && typeof o.allocation === 'object' ? (o.allocation as Record<string, unknown>) : null;
  const byNetwork = alloc ? concList(alloc.byNetwork) : null;
  const byCategory = alloc ? concList(alloc.byCategory) : null;
  if (!t || !h || !byNetwork || !byCategory) return { kind: 'failed' };
  return {
    kind: 'ok',
    at: o.latestCompleteObservedAt,
    newerPartial,
    newerUnattributed,
    recordedRunMembership: m,
    networks: networks as ViewNetwork[],
    totals: t,
    allocation: { byNetwork, byCategory },
    history: h,
  };
}
