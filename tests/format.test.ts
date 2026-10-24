import { describe, expect, it } from 'vitest';
import { fmtAmount, fmtPrice, fmtUsd, roundDecimal } from '../features/portfolio/format';

describe('decimal rounding is on the digits, half-up', () => {
  it.each([
    ['17561.045954', 2, '17561.05'],
    ['0.995', 2, '1.00'],
    ['0.994999', 2, '0.99'],
    ['9.99995', 4, '10.0000'],
    ['5.773445691890789631', 6, '5.773446'],
    ['12', 2, '12'],
    ['1.5', 6, '1.5'],
    ['0.0000004', 6, '0.000000'],
    ['123456789012345678901234567890.123456789', 2, '123456789012345678901234567890.12'],
  ])('%s to %i', (s, dp, out) => expect(roundDecimal(s, dp)).toBe(out));
  it('leaves non-decimal strings alone', () => {
    expect(roundDecimal('-1.5', 2)).toBe('-1.5');
    expect(roundDecimal('1e5', 2)).toBe('1e5');
    expect(roundDecimal('', 2)).toBe('');
  });
});
describe('display formats', () => {
  it('USD: 2 places, thousands separators, never hides a nonzero value as zero', () => {
    expect(fmtUsd('17561.045954', false)).toBe('$17,561.05');
    expect(fmtUsd('1.5', false)).toBe('$1.50');
    expect(fmtUsd('0', false)).toBe('$0.00');
    expect(fmtUsd('0.004', false)).toBe('<$0.01');
    expect(fmtUsd('17561.045954', true)).toBe('$17,561.045954');
  });
  it('leading zeros are normalized before choosing a format', () => {
    expect(fmtPrice('00.99985102', false)).toBe('$0.9999');
    expect(fmtPrice('0002383.71109191', false)).toBe('$2,383.71');
    expect(fmtAmount('007.5', false)).toBe('7.5');
    expect(fmtUsd('00012.5', false)).toBe('$12.50');
    expect(fmtUsd('0', false)).toBe('$0.00');
  });
  it('a tiny unit price is not shown as zero or as a cent threshold', () => {
    expect(fmtPrice('0.000049', false)).toBe('<$0.0001');
    expect(fmtPrice('0.00012', false)).toBe('$0.0001');
    expect(fmtPrice('0', false)).toBe('$0.00');
  });
  it('price: 4 places under $10, 2 at or above, min 2 shown', () => {
    expect(fmtPrice('2383.71109191', false)).toBe('$2,383.71');
    expect(fmtPrice('0.99985102', false)).toBe('$0.9999');
    expect(fmtPrice('1', false)).toBe('$1.00');
    expect(fmtPrice('1.00007363', false)).toBe('$1.0001');
    expect(fmtPrice('2383.71109191', true)).toBe('$2,383.71109191');
  });
  it('amount: up to 6 places, trimmed; tiny stays visible; exact is whole', () => {
    expect(fmtAmount('5.773445691890789631', false)).toBe('5.773446');
    expect(fmtAmount('1.5', false)).toBe('1.5');
    expect(fmtAmount('1000', false)).toBe('1,000');
    expect(fmtAmount('0.0000004', false)).toBe('<0.000001');
    expect(fmtAmount('0', false)).toBe('0');
    expect(fmtAmount('5.773445691890789631', true)).toBe('5.773445691890789631');
  });
});
