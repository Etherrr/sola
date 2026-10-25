import type { PriceKind } from '../../features/markets/model';

/**
 * The fixed instrument allowlist for the Markets overview. NOTHING outside this list is ever
 * requested or displayed. Mints were verified against the official issuer registry named on
 * each entry on 2026-10-25 (see docs/MARKETS_OVERVIEW.md for the URLs); a symbol search result
 * is never accepted as identity. Wrapped SOL is priced as SOL with the wrapper made explicit;
 * no instrument here is labeled as an underlying security or as a cross-chain asset.
 */
export type Instrument = {
  id: string;
  /** Display symbol, e.g. 'SOL', 'TSLAx'. */
  symbol: string;
  name: string;
  kind: PriceKind;
  /** Issuer for tokenized instruments (displayed); null for native assets. */
  issuer: string | null;
  /** Underlying ticker for tokenized instruments (displayed as 'tracks X'); null otherwise. */
  underlying: string | null;
  chain: 'solana';
  mint: string;
};

/** Recognized quote mints. USDC: Circle official contract list. USDT: Tether supported-protocols page. */
export const QUOTE_MINTS: Readonly<Record<string, string>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: 'sol',
    symbol: 'SOL',
    name: 'Solana',
    kind: 'native-asset',
    issuer: null,
    underlying: null,
    chain: 'solana',
    // Wrapped SOL mint, official SPL Token-2022 interface source (native_mint.rs).
    mint: 'So11111111111111111111111111111111111111112',
  },
  {
    id: 'tslax',
    symbol: 'TSLAx',
    name: 'Tesla xStock',
    kind: 'tokenized-equity',
    issuer: 'Backed (xStocks)',
    underlying: 'TSLA',
    chain: 'solana',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  },
  {
    id: 'nvdax',
    symbol: 'NVDAx',
    name: 'NVIDIA xStock',
    kind: 'tokenized-equity',
    issuer: 'Backed (xStocks)',
    underlying: 'NVDA',
    chain: 'solana',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  },
  {
    id: 'aaplx',
    symbol: 'AAPLx',
    name: 'Apple xStock',
    kind: 'tokenized-equity',
    issuer: 'Backed (xStocks)',
    underlying: 'AAPL',
    chain: 'solana',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  },
  {
    id: 'spyx',
    symbol: 'SPYx',
    name: 'SP500 xStock',
    kind: 'tokenized-equity',
    issuer: 'Backed (xStocks)',
    underlying: 'SPY',
    chain: 'solana',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  },
];

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Module-load integrity check: a malformed or duplicated entry fails fast, never silently. */
function validate(list: readonly Instrument[]): void {
  const ids = new Set<string>();
  const mints = new Set<string>();
  for (const i of list) {
    if (!i.id || !i.symbol || !i.name) throw new Error('instrument missing display fields');
    if (!MINT_RE.test(i.mint)) throw new Error(`instrument ${i.id}: bad mint format`);
    if (i.chain !== 'solana') throw new Error(`instrument ${i.id}: unsupported chain`);
    if (i.kind === 'tokenized-equity' && (!i.issuer || !i.underlying))
      throw new Error(`instrument ${i.id}: tokenized instrument needs issuer and underlying`);
    if (i.kind === 'native-asset' && (i.issuer !== null || i.underlying !== null))
      throw new Error(`instrument ${i.id}: native asset must not claim an issuer or underlying`);
    if (ids.has(i.id)) throw new Error(`duplicate instrument id ${i.id}`);
    if (mints.has(i.mint)) throw new Error(`duplicate mint for ${i.id}`);
    ids.add(i.id);
    mints.add(i.mint);
  }
  for (const mint of Object.keys(QUOTE_MINTS))
    if (!MINT_RE.test(mint)) throw new Error('bad quote mint format');
}
validate(INSTRUMENTS);
