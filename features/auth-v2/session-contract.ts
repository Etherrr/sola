/** Display identity is distinct from optional verified email. No credential IDs. */
export type NativeDisplayIdentity = {
  kind: 'email' | 'wallet_evm' | 'wallet_solana';
  identifier: string;
};
export type VerifiedNativeSession = {
  kind: 'ok'; identity: NativeDisplayIdentity; displayLabel: string;
  email: string | null; fresh: boolean;
};
export function parseNativeSession(value: unknown): VerifiedNativeSession | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.status !== 'ok') return null;
  // Older deployed email responses remain readable during a rolling client update.
  const identity = body.identity ?? (typeof body.email === 'string'
    ? { kind: 'email', identifier: body.email } : null);
  if (!identity || typeof identity !== 'object') return null;
  const i = identity as Record<string, unknown>;
  if (!['email', 'wallet_evm', 'wallet_solana'].includes(String(i.kind)) ||
      typeof i.identifier !== 'string' || !i.identifier || i.identifier.length > 254) return null;
  if (i.kind === 'wallet_evm' && !/^0x[0-9a-fA-F]{40}$/.test(i.identifier)) return null;
  if (i.kind === 'wallet_solana' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(i.identifier)) return null;
  if (i.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.identifier)) return null;
  const verified = i as NativeDisplayIdentity;
  return { kind: 'ok', identity: verified, displayLabel: verified.identifier,
    email: verified.kind === 'email' ? verified.identifier : null, fresh: body.fresh === true };
}
