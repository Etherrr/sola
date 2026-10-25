import { QUOTE_MINTS, type Instrument } from './instruments';
import { isDecimalString, toScaled } from './decimal';

/**
 * DexScreener upstream adapter. One hardcoded public endpoint host, GET only, no key, no
 * account data of any kind is sent: the URL path contains only the public token mint from the
 * fixed allowlist. Display rights: commercial and non-commercial use is permitted by the
 * published API terms (docs.dexscreener.com/api/api-terms-and-conditions, read 2026-10-25);
 * rate limit 300 req/min on this endpoint family. Nothing here runs on a schedule: calls
 * happen only when the gated API route asks for them (manual page load / explicit refresh).
 */
export const DEXSCREENER_HOST = 'https://api.dexscreener.com';
export const MAX_RESPONSE_BYTES = 384 * 1024;
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_PAIRS = 50;
/** A pool below this USD liquidity never contributes a displayed price. */
export const MIN_VENUE_LIQUIDITY_USD = 10_000;
/** Spread across qualified venues above this percent raises a wide-dispersion warning. */
export const DISPERSION_WARN_PCT = '1';

export type QualifiedPair = {
  dexId: string;
  pairAddress: string;
  /** Exact decimal string from the feed. */
  priceUsd: string;
  quoteSymbol: string;
  /** JSON number from the feed; used ONLY for thresholding/ranking, never displayed as a quote. */
  liquidityUsd: number;
};

export type FetchPairsResult =
  | { ok: true; pairs: QualifiedPair[] }
  | { ok: false; reason: 'timeout' | 'http' | 'too_large' | 'invalid_body' | 'fetch_error' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isShortStr = (v: unknown, n: number): v is string => typeof v === 'string' && v.length <= n;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PAIR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/** Strict per-pair validation and qualification. Anything unexpected is dropped, never guessed. */
export function qualifyPairs(raw: unknown, inst: Instrument): QualifiedPair[] {
  if (!Array.isArray(raw)) return [];
  const out: QualifiedPair[] = [];
  for (const p of raw.slice(0, MAX_PAIRS)) {
    if (!isObj(p)) continue;
    if (p.chainId !== inst.chain) continue;
    const base = p.baseToken;
    const quote = p.quoteToken;
    if (!isObj(base) || !isObj(quote)) continue;
    // The allowlist token must be the BASE side; we never invert a price.
    if (base.address !== inst.mint) continue;
    // Only recognized USD stablecoin quotes.
    const quoteSymbol = isShortStr(quote.address, 64) ? QUOTE_MINTS[quote.address] : undefined;
    if (!quoteSymbol) continue;
    if (!isShortStr(p.pairAddress, 64) || !PAIR_RE.test(p.pairAddress)) continue;
    if (!isShortStr(p.dexId, 24) || !/^[a-z0-9_-]+$/.test(p.dexId)) continue;
    if (!isDecimalString(p.priceUsd) || p.priceUsd.length > 24) continue;
    if (toScaled(p.priceUsd) <= 0n) continue;
    const liq = isObj(p.liquidity) ? p.liquidity.usd : undefined;
    if (typeof liq !== 'number' || !Number.isFinite(liq) || liq < MIN_VENUE_LIQUIDITY_USD) continue;
    out.push({
      dexId: p.dexId,
      pairAddress: p.pairAddress,
      priceUsd: p.priceUsd,
      quoteSymbol,
      liquidityUsd: liq,
    });
  }
  return out;
}

/** Ranked by pool liquidity (a heuristic threshold input, never a displayed figure). */
export function pickPrimary(pairs: QualifiedPair[]): QualifiedPair | null {
  let best: QualifiedPair | null = null;
  for (const p of pairs) if (!best || p.liquidityUsd > best.liquidityUsd) best = p;
  return best;
}

async function readCapped(res: Response, limit: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

export async function fetchTokenPairs(
  fetchImpl: typeof fetch,
  inst: Instrument,
  parent: AbortSignal,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<FetchPairsResult> {
  if (!MINT_RE.test(inst.mint)) return { ok: false, reason: 'invalid_body' };
  const ctl = new AbortController();
  const onParent = () => ctl.abort();
  parent.addEventListener('abort', onParent, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${DEXSCREENER_HOST}/token-pairs/v1/solana/${inst.mint}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'http' };
    const text = await readCapped(res, MAX_RESPONSE_BYTES);
    if (text === null) return { ok: false, reason: 'too_large' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'invalid_body' };
    }
    return { ok: true, pairs: qualifyPairs(parsed, inst) };
  } catch {
    return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParent);
  }
}
