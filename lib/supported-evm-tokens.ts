// The single source for the EVM token set the read-only providers recognize.
// The live provider prices exactly these contracts; UI coverage labels derive from
// the same list so a badge or note can never drift from what is actually read.
export type SupportedEvmToken = {
  symbol: string;
  address: string;
  decimals: number;
  feed: 'ETH/USD' | 'USDC/USD' | 'USDT/USD' | 'DAI/USD';
};
// symbol() and decimals() of each contract were read on-chain on 2026-10-23.
export const SUPPORTED_EVM_TOKENS: readonly SupportedEvmToken[] = [
  {
    symbol: 'USDC',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    feed: 'USDC/USD',
  },
  {
    symbol: 'USDT',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: 6,
    feed: 'USDT/USD',
  },
  {
    symbol: 'DAI',
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    decimals: 18,
    feed: 'DAI/USD',
  },
  // Wrapped ether is priced with the ETH/USD feed (a 1:1 wrapper; a depeg would not show).
  {
    symbol: 'WETH',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    decimals: 18,
    feed: 'ETH/USD',
  },
];
/** Display order: native ETH first, then the tracked tokens. */
export const SUPPORTED_EVM_SYMBOLS: readonly string[] = [
  'ETH',
  ...SUPPORTED_EVM_TOKENS.map((t) => t.symbol),
];
/** 'ETH plus USDC, USDT, DAI and WETH (5 assets total)' - derived, never hardcoded. */
export const evmCoverageLabel = (): string => {
  const rest = SUPPORTED_EVM_SYMBOLS.slice(1);
  return `${SUPPORTED_EVM_SYMBOLS[0]} plus ${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]} (${SUPPORTED_EVM_SYMBOLS.length} assets total)`;
};
