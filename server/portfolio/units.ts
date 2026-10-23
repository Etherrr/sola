// Integer-unit helpers. Money and token amounts are never floats.
export function formatUnits(raw: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 77) throw new RangeError('decimals out of range');
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** price is a decimal string in USD per whole token (max 18 fractional digits). Returns USD cents*1e4 style
 *  micro-dollars as a decimal string value, computed with bigint only. */
export function valueUsd(raw: bigint, decimals: number, price: string): string {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(price);
  if (!m) throw new RangeError('bad price');
  const fracLen = (m[2] ?? '').length;
  const priceInt = BigInt(m[1]! + (m[2] ?? ''));
  // value = raw * priceInt / 10^(decimals + fracLen), kept to 6 fractional digits (truncated).
  const scaled = (raw * priceInt * 1_000_000n) / 10n ** BigInt(decimals + fracLen);
  return formatUnits(scaled, 6);
}
