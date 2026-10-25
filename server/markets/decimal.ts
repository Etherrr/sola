/**
 * Exact-decimal helpers. Prices from venue feeds are decimal STRINGS; no floating-point
 * financial arithmetic anywhere in the markets path. Comparisons and spread math run on
 * BigInt values scaled to a fixed number of decimal places.
 */

export const DEC = /^\d+(\.\d+)?$/;
export const isDecimalString = (v: unknown): v is string => typeof v === 'string' && DEC.test(v);

const SCALE = 8n;
const SCALE_FACTOR = 10n ** SCALE;

/** Parses a validated decimal string into a BigInt scaled by 10^8. */
export function toScaled(dec: string): bigint {
  const [whole, frac = ''] = dec.split('.');
  const fracPadded = (frac + '00000000').slice(0, 8);
  // Fractions longer than 8 dp are truncated for comparison only; the original string is
  // always what gets displayed. Truncation can only understate a spread by < 1e-8.
  return BigInt(whole) * SCALE_FACTOR + BigInt(fracPadded);
}

export const cmpDecimal = (a: string, b: string): number => {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** max(0, (hi - lo) / hi * 100) as a 2-dp decimal string, computed with BigInt only. */
export function spreadPct(lo: string, hi: string): string {
  const l = toScaled(lo);
  const h = toScaled(hi);
  if (h <= 0n || h <= l) return '0';
  // basis points = (h - l) * 10000 / h, rounded to nearest bp
  const bps = ((h - l) * 10000n + h / 2n) / h;
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}
