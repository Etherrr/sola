'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { lookupAddresses, addressBookRequest } from '../portfolio/api-client';
import { aggregateAddresses } from '../portfolio/aggregate';
import {
  combinedInputs,
  combinedMode,
  combinedProviders,
  networksWithAccounts,
  type NetworkResults,
} from '../portfolio/combined-load';
import type { SavedAccount } from '../portfolio/accounts-client';
import { ADDRESSES_CHANGED_EVENT } from './address-book';
import { SYNCED_EVENT } from './snapshot-consent';

/**
 * One shared combined-read state for the v0.2 Overview. The explicit combined
 * load fills both the "All saved addresses" block and the Allocation panel
 * from the SAME single request set - allocation never sends the saved
 * addresses to a provider a second time. Invalidation (address add/rename/
 * remove, a sync, a recording withdrawal) resets every consumer at once, and
 * the generation guard drops in-flight responses from before the change.
 */

type Entry = {
  network: 'ethereum' | 'solana';
  address: string;
  label: string;
};

export type CombinedPhase =
  | { kind: 'idle'; notice?: string }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'ready';
      result: ReturnType<typeof aggregateAddresses>;
      mode: 'live' | 'mock' | 'none';
      providers: string[];
      totalSaved: number;
      loadedAt: string;
    };

type CombinedValue = { phase: CombinedPhase; load: () => void };

const CombinedContext = createContext<CombinedValue | null>(null);

export function useCombined(): CombinedValue {
  const ctx = useContext(CombinedContext);
  if (!ctx) throw new Error('useCombined must be used inside <CombinedProvider>.');
  return ctx;
}

export function CombinedProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<CombinedPhase>({ kind: 'idle' });
  const generation = useRef(0);
  const kindRef = useRef(phase.kind);
  useEffect(() => {
    kindRef.current = phase.kind;
  }, [phase.kind]);

  // An address add/rename/remove, a sync, or a recording withdrawal invalidates
  // any shown combination: drop back to idle with a one-line reason (reviewer
  // note: a silent reset read as data loss), and bump the generation so an
  // in-flight response from before the change can never paint stale figures.
  useEffect(() => {
    const onAddresses = () => {
      generation.current++;
      setPhase({
        kind: 'idle',
        notice: 'Saved addresses changed - the earlier combination was cleared.',
      });
    };
    const onSynced = () => {
      generation.current++;
      setPhase({ kind: 'idle', notice: 'A sync ran - the earlier combination was cleared.' });
    };
    window.addEventListener(ADDRESSES_CHANGED_EVENT, onAddresses);
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => {
      window.removeEventListener(ADDRESSES_CHANGED_EVENT, onAddresses);
      window.removeEventListener(SYNCED_EVENT, onSynced);
    };
  }, []);

  const load = useCallback(() => {
    if (kindRef.current === 'loading') return;
    const g = ++generation.current;
    setPhase({ kind: 'loading' });
    void (async () => {
      let res: Response;
      try {
        res = await addressBookRequest('GET', undefined);
      } catch {
        if (generation.current === g)
          setPhase({
            kind: 'failed',
            message: 'Saved addresses could not be read. Nothing was substituted.',
          });
        return;
      }
      if (generation.current !== g) return;
      if (res.status === 401) {
        setPhase({ kind: 'failed', message: 'Sign in to load your saved addresses.' });
        return;
      }
      if (res.status === 503) {
        setPhase({
          kind: 'failed',
          message: 'Saved addresses are switched off on this build. Nothing was read.',
        });
        return;
      }
      if (!res.ok) {
        setPhase({
          kind: 'failed',
          message: 'Saved addresses could not be read. Nothing was substituted.',
        });
        return;
      }
      const body = (await res.json()) as { status?: string; addresses?: Entry[] };
      if (body.status !== 'ok' || !Array.isArray(body.addresses)) {
        setPhase({
          kind: 'failed',
          message: 'Saved addresses could not be read. Nothing was substituted.',
        });
        return;
      }
      if (body.addresses.length === 0) {
        setPhase({ kind: 'empty' });
        return;
      }
      const accounts: SavedAccount[] = body.addresses.map((a) => ({
        network: a.network,
        address: a.address,
        label: a.label,
        createdAt: '',
        updatedAt: '',
      }));
      const networks = networksWithAccounts(accounts);
      const results: NetworkResults = {};
      await Promise.all(
        networks.map(async (n) => {
          results[n] = await lookupAddresses(
            n,
            accounts.filter((a) => a.network === n).map((a) => a.address),
          );
        }),
      );
      if (generation.current !== g) return;
      setPhase({
        kind: 'ready',
        result: aggregateAddresses(combinedInputs(accounts, results)),
        mode: combinedMode(results),
        providers: combinedProviders(results),
        totalSaved: accounts.length,
        loadedAt: new Date().toISOString(),
      });
    })();
  }, []);

  return (
    <CombinedContext.Provider value={{ phase, load }}>{children}</CombinedContext.Provider>
  );
}
