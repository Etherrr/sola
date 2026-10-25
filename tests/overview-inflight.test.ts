import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn<() => Promise<Response>>();
vi.mock('../features/portfolio/api-client', () => ({
  overviewHistoryRequest: () => request(),
}));

import {
  fetchOverview,
  invalidateOverview,
} from '../features/portfolio-v2/overview-history';

const OK_BODY = JSON.stringify({
  status: 'empty',
  newerPartial: false,
});
const okResponse = () => new Response(OK_BODY, { status: 200 });

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  request.mockReset();
});

describe('fetchOverview shared in-flight request', () => {
  it('joins concurrent callers onto one network request', async () => {
    request.mockResolvedValue(okResponse());
    const [a, b] = await Promise.all([fetchOverview(), fetchOverview()]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe('empty');
    expect(b.kind).toBe('empty');
  });

  it('invalidateOverview forces a fresh request while the old one is still pending', async () => {
    const first = deferred<Response>();
    request.mockReturnValueOnce(first.promise);
    const stale = fetchOverview();
    expect(request).toHaveBeenCalledTimes(1);

    invalidateOverview();
    const second = deferred<Response>();
    request.mockReturnValueOnce(second.promise);
    const fresh = fetchOverview();
    expect(request).toHaveBeenCalledTimes(2);

    // The superseded request settling must not clear the newer in-flight one.
    first.resolve(okResponse());
    await stale;
    const third = fetchOverview();
    expect(third).toBe(fresh); // still the same in-flight promise, no third request
    expect(request).toHaveBeenCalledTimes(2);

    second.resolve(okResponse());
    expect((await fresh).kind).toBe('empty');
  });
});
