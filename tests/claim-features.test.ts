/**
 * Claim feature discovery (server/claim/features.ts + its mount): the client
 * gate for "no claim fetch while the feature is off". All-local; a database
 * object that throws on ANY use proves the handler never touches one.
 */
import { describe, it, expect } from 'vitest';
import { handleClaimFeatures } from '../server/claim/features';
import type { ClaimEnv } from '../server/claim/routes';

const boomDb = new Proxy(
  {},
  {
    get() {
      throw new Error('database must not be touched');
    },
  },
);

const env = (over: Partial<ClaimEnv>): ClaimEnv => ({
  NATIVE_AUTH_ENABLED: 'true',
  CLAIM_ENABLED: '1',
  PORTFOLIO_ACCOUNTS_DB: boomDb as never,
  ...over,
});

describe('claim feature discovery', () => {
  it('gate open: { claim: true }', async () => {
    const r = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({}));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ claim: true });
  });
  it('flag absent: { claim: false }', async () => {
    const r = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({ CLAIM_ENABLED: undefined }));
    expect(await r.json()).toEqual({ claim: false });
  });
  it('flag wrong value: { claim: false }', async () => {
    const r = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({ CLAIM_ENABLED: 'true' }));
    expect(await r.json()).toEqual({ claim: false });
  });
  it('native auth off: { claim: false }', async () => {
    const r = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({ NATIVE_AUTH_ENABLED: 'false' }));
    expect(await r.json()).toEqual({ claim: false });
  });
  it('no D1 binding: { claim: false }', async () => {
    const r = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({ PORTFOLIO_ACCOUNTS_DB: undefined }));
    expect(await r.json()).toEqual({ claim: false });
  });
  it('405 on POST, no-store + noindex headers, needs no session/assertion/origin', async () => {
    const post = await handleClaimFeatures(
      new Request('https://x.test/api/v1/claim/features', { method: 'POST' }),
      env({}),
    );
    expect(post.status).toBe(405);
    const get = await handleClaimFeatures(new Request('https://x.test/api/v1/claim/features'), env({}));
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(get.headers.get('x-robots-tag')).toContain('noindex');
  });
});
