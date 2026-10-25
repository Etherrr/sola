import { expect, it, vi } from 'vitest';
import { unconfiguredMarketProvider } from '../server/markets/provider';

it('unapproved market sources return unavailable without contacting any service', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  try {
    const result = await unconfiguredMarketProvider.read(new AbortController().signal);
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'source-not-approved',
      observations: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
