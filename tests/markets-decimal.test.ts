import { describe, expect, it } from 'vitest';
import { cmpDecimal, isDecimalString, spreadPct, toScaled } from '../server/markets/decimal';

describe('decimal helpers keep exact-string semantics', () => {
  it('accepts only plain decimal strings', () => {
    expect(isDecimalString('371.52')).toBe(true);
    expect(isDecimalString('0.000001')).toBe(true);
    for (const bad of ['', '.5', '1.', '1e3', '-2', 'NaN', '1,2', ' 1', '1 '])
      expect(isDecimalString(bad)).toBe(false);
  });
  it('compares without floats', () => {
    expect(cmpDecimal('102.41', '102.4')).toBe(1);
    expect(cmpDecimal('371.19', '371.59')).toBe(-1);
    expect(cmpDecimal('1.00', '1')).toBe(0);
    expect(cmpDecimal('0.00000001', '0.00000002')).toBe(-1);
  });
  it('computes spread with BigInt only', () => {
    expect(spreadPct('371.19', '371.94')).toBe('0.20');
    expect(spreadPct('100', '100')).toBe('0');
    expect(spreadPct('100', '50')).toBe('0'); // caller passes lo,hi; inverted input clamps to 0
    expect(spreadPct('1', '2')).toBe('50.00');
    expect(spreadPct('0.5', '1')).toBe('50.00');
  });
  it('scaling truncates past 8dp for comparison only', () => {
    expect(toScaled('1.000000001')).toBe(toScaled('1'));
  });
});
