import { describe, expect, it } from 'vitest';
import { feedTimeUTC } from '../features/portfolio-v2/format-time';

describe('feedTimeUTC', () => {
  it('renders a UTC ISO instant compactly, matching the /track presentation', () => {
    expect(feedTimeUTC('2026-10-23T11:58:00Z')).toBe('2026-10-23 11:58 UTC');
  });
  it('normalizes an offset-bearing ISO to UTC instead of mislabeling its wall time', () => {
    expect(feedTimeUTC('2026-10-23T13:58:00+02:00')).toBe('2026-10-23 11:58 UTC');
  });
  it('normalizes a negative offset across a date boundary', () => {
    expect(feedTimeUTC('2026-10-23T22:58:00-05:00')).toBe('2026-10-24 03:58 UTC');
  });
  it('passes an unparseable value through unchanged', () => {
    expect(feedTimeUTC('not-a-date')).toBe('not-a-date');
  });
});
