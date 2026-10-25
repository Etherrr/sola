/**
 * Human asset labels derived from the assetId exactly as providers store it
 * ('eip155:1/native' -> ETH, 'solana:mainnet/native' -> SOL,
 * 'eip155:1/erc20:0xA0b8\u2026eB48' for a token contract). A display name only
 * - the raw assetId stays available (title attribute) and remains the identity
 * key everywhere. Never invents a symbol: only the two native ids this product
 * actually observes map to chain symbols, a token contract is shortened with
 * its checksum case PRESERVED (case is data on EVM, identity on Solana), and
 * anything unrecognized falls back to its own identifier segment unchanged.
 */
export function assetLabel(assetId: string): string {
  const slash = assetId.indexOf('/');
  if (slash < 0) return assetId;
  const net = assetId.slice(0, slash);
  const rest = assetId.slice(slash + 1);
  if (rest === 'native') {
    if (net === 'eip155:1') return 'ETH';
    if (net === 'solana' || net.startsWith('solana:')) return 'SOL';
    return 'NATIVE';
  }
  const m = /^erc20:(.+)$/.exec(rest);
  if (m) {
    const c = m[1]!;
    if (/^0x[0-9a-fA-F]{40}$/.test(c)) return `${c.slice(0, 6)}\u2026${c.slice(-4)}`;
    return c;
  }
  const colon = rest.lastIndexOf(':');
  return colon >= 0 ? rest.slice(colon + 1) : rest;
}
