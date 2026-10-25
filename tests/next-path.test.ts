import { describe, expect, it } from 'vitest';
import { safeNextPath, DEFAULT_NEXT } from '../features/auth-v2/next-path';

describe('safeNextPath', () => {
  it('passes plain same-origin paths and queries', () => {
    expect(safeNextPath('/dev/overview-v2')).toBe('/dev/overview-v2');
    expect(safeNextPath('/portfolio?tab=assets')).toBe('/portfolio?tab=assets');
    expect(safeNextPath('/portfolio/risk')).toBe('/portfolio/risk');
  });
  it('falls back on empty input', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath('')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('x'.repeat(201))).toBe(DEFAULT_NEXT);
  });
  it('rejects absolute and scheme URLs', () => {
    expect(safeNextPath('https://evil.example/x')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('javascript:alert(1)')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('evil.example')).toBe(DEFAULT_NEXT);
  });
  it('rejects protocol-relative and backslash forms', () => {
    expect(safeNextPath('//evil.example/x')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/\\evil.example')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/dev\\..\\x')).toBe(DEFAULT_NEXT);
  });
  it('rejects every percent-encoded form, no decode arms race', () => {
    expect(safeNextPath('/%2f%2fevil.example')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('%2f%2fevil.example')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/dev%2f..%2fx')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/%252f%252fevil.example')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/%5cevil')).toBe(DEFAULT_NEXT);
  });
  it('rejects traversal and control chars', () => {
    expect(safeNextPath('/dev/../admin')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/dev/x\nLocation: evil')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/dev x')).toBe(DEFAULT_NEXT);
  });
  it('honors a custom fallback', () => {
    expect(safeNextPath('//evil', '/sign-in')).toBe('/sign-in');
  });
});
