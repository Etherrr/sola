/**
 * Human asset labels derived deterministically from the normalized assetId
 * ('eth/native' -> ETH, 'sol/native' -> SOL, 'eth/erc20:usdc' -> USDC).
 * A display name only - the raw assetId stays available (title attribute)
 * and remains the identity key everywhere. Never invents a name: an
 * unrecognized shape falls back to its own identifier segment, case
 * preserved (Solana mints are case-sensitive).
 */
export function assetLabel(assetId: string): string {
  const slash = assetId.indexOf('/');
  if (slash < 0) return assetId;
  const net = assetId.slice(0, slash);
  const rest = assetId.slice(slash + 1);
  if (rest === 'native') return net === 'eth' ? 'ETH' : net === 'sol' ? 'SOL' : 'NATIVE';
  const m = /^erc20:(.+)$/.exec(rest);
  if (m) return m[1]!.toUpperCase();
  const colon = rest.lastIndexOf(':');
  return colon >= 0 ? rest.slice(colon + 1) : rest;
}
