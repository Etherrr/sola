// Display formatting for the recorded views. Wire values are DECIMAL STRINGS
// (BigInt-safe); the string-based helpers in portfolio/format do the rounding.
// Nothing here ever converts a wire value through a float.
import { fmtAmount, fmtPrice, fmtUsd, roundDecimal } from '../portfolio/format';

export const usd = (raw: string | null): string => (raw === null ? 'Unknown' : fmtUsd(raw, false));
export const price = (raw: string | null): string => (raw === null ? 'Unknown' : fmtPrice(raw, false));
export const amount = (raw: string): string => fmtAmount(raw, false);
export const pct = (raw: string | null): string => {
  if (raw === null) return 'Unknown';
  const r = roundDecimal(raw, 1);
  const [i, f = ''] = r.split('.');
  return `${i}.${f.padEnd(1, '0').slice(0, 1)}%`;
};

/** Shift the decimal point of a non-negative decimal string right by `places`
 *  ("0.1395", 2 -> "13.95") - string math only. */
export const shiftDecimal = (raw: string, places: number): string => {
  const neg = raw.startsWith('-');
  const s = neg ? raw.slice(1) : raw;
  const [i = '0', f = ''] = s.split('.');
  const digits = i + f;
  const point = i.length + places;
  let whole: string;
  let frac: string;
  if (point <= 0) {
    whole = '0';
    frac = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length);
    frac = '';
  } else {
    whole = digits.slice(0, point);
    frac = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
};

/** Compare two non-negative decimal strings without floats (sort helpers). */
export const cmpDecimal = (a: string, b: string): number => {
  const norm = (s: string) => {
    const neg = s.startsWith('-');
    const t = neg ? s.slice(1) : s;
    const [i = '0', f = ''] = t.split('.');
    return { neg, i: i.replace(/^0+(?=\d)/, ''), f };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  if (x.i.length !== y.i.length) return sign * (x.i.length - y.i.length);
  if (x.i !== y.i) return sign * (x.i < y.i ? -1 : 1);
  const fl = Math.max(x.f.length, y.f.length);
  const xf = x.f.padEnd(fl, '0');
  const yf = y.f.padEnd(fl, '0');
  if (xf === yf) return 0;
  return sign * (xf < yf ? -1 : 1);
};
