// Display formatting for decimal strings. Works on the digits only (BigInt), never on floats, so a
// rounded figure is the true rounding of the exact string. Anything unexpected is returned as is.
const DEC = /^\d+(\.\d+)?$/;
/** Same number without leading zeros in the whole part ("00.5" -> "0.5"); other strings unchanged. */
const norm = (s: string) => (DEC.test(s) ? s.replace(/^0+(?=\d)/, '') : s);

/** Round a non-negative decimal string half-up to `dp` places. */
export function roundDecimal(s: string, dp: number): string {
  if (!DEC.test(s)) return s;
  const [i = '0', f = ''] = s.split('.');
  if (f.length <= dp) return f.length ? s : i;
  const scaled = BigInt(i + f.slice(0, dp)) + (f.charCodeAt(dp) >= 53 ? 1n : 0n);
  const digits = scaled.toString().padStart(dp + 1, '0');
  return dp === 0 ? digits : `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
}
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const withGroups = (s: string) => {
  const [i = '0', f] = s.split('.');
  return f === undefined ? group(i) : `${group(i)}.${f}`;
};
const isZero = (s: string) => !/[1-9]/.test(s);

/** USD value or subtotal: 2 places and thousands separators; exact keeps every digit. */
export function fmtUsd(raw: string, exact: boolean): string {
  const s = norm(raw);
  if (!DEC.test(s)) return `$${s}`;
  if (exact) return `$${withGroups(s)}`;
  const r = roundDecimal(s, 2);
  const padded = r.includes('.') ? r.padEnd(r.indexOf('.') + 3, '0') : `${r}.00`;
  return !isZero(s) && isZero(r) ? '<$0.01' : `$${withGroups(padded)}`;
}
/** Unit price: 4 places under $10, else 2; at least 2 places shown. */
export function fmtPrice(raw: string, exact: boolean): string {
  const s = norm(raw);
  if (!DEC.test(s)) return `$${s}`;
  if (exact) return `$${withGroups(s)}`;
  const big = (s.split('.')[0] ?? '0').length >= 2;
  let r = roundDecimal(s, big ? 2 : 4);
  if (r.includes('.')) r = r.replace(/0+$/, '').replace(/\.$/, '');
  const frac = r.includes('.') ? r.split('.')[1]!.length : 0;
  if (frac < 2)
    r = (r.includes('.') ? r : `${r}.`).padEnd(
      (r.includes('.') ? r : `${r}.`).indexOf('.') + 3,
      '0',
    );
  return !isZero(s) && isZero(r) ? '<$0.0001' : `$${withGroups(r)}`;
}
/** Token amount: up to 6 places, trailing zeros trimmed; exact keeps every digit. */
export function fmtAmount(raw: string, exact: boolean): string {
  const s = norm(raw);
  if (!DEC.test(s)) return s;
  if (exact) return withGroups(s);
  let r = roundDecimal(s, 6);
  if (r.includes('.')) r = r.replace(/0+$/, '').replace(/\.$/, '');
  return !isZero(s) && isZero(r) ? '<0.000001' : withGroups(r);
}
/** True when rounding changes the shown digits, so the exact toggle is worth offering. */
export const differsWhenRounded = (amount: string, price: string | null, value: string | null) =>
  fmtAmount(amount, true) !== fmtAmount(amount, false) ||
  (price !== null && fmtPrice(price, true) !== fmtPrice(price, false)) ||
  (value !== null && fmtUsd(value, true) !== fmtUsd(value, false));
