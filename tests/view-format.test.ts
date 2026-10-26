import { describe, expect, it } from 'vitest';
import { amount, cmpDecimal, pct, price, shiftDecimal, usd } from '../features/portfolio-v2/view-format';

/** Decimal-string display helpers for the recorded views: string math only,
 *  never floats. */
describe('view formatting', () => {
  it('shifts decimal points as strings', () => {
    expect(shiftDecimal('0.1395', 2)).toBe('13.95');
    expect(shiftDecimal('1', 2)).toBe('100');
    expect(shiftDecimal('0.05', 2)).toBe('5');
    expect(shiftDecimal('12.3400', 2)).toBe('1234');
    expect(shiftDecimal('-0.25', 2)).toBe('-25');
  });

  it('compares decimal strings without floats', () => {
    expect(cmpDecimal('2', '10')).toBeLessThan(0);
    expect(cmpDecimal('10', '2')).toBeGreaterThan(0);
    expect(cmpDecimal('0.5', '0.25')).toBeGreaterThan(0);
    expect(cmpDecimal('1.0', '1')).toBe(0);
    expect(cmpDecimal('-1', '0.5')).toBeLessThan(0);
    expect(cmpDecimal('9000', '4750.5')).toBeGreaterThan(0);
  });

  it('renders Unknown for null USD figures and never zero', () => {
    expect(usd(null)).toBe('Unknown');
    expect(price(null)).toBe('Unknown');
    expect(usd('4750')).toBe('$4,750.00');
    expect(usd('0.0000001')).toBe('<$0.01');
    expect(amount('9000')).toBe('9,000');
    expect(pct('55')).toBe('55.0%');
    expect(pct(null)).toBe('Unknown');
  });
});
