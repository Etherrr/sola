'use client';
import { useSearchParams } from 'next/navigation';
import { ClaimPanel } from './claim-panel';
import { ClaimSection } from './claim-section';
import { FIXTURES, type FixtureName } from './fixtures';
import type { ClaimApi } from './claim-api';

/** Picks the scripted fixture for the dev preview page (?case=...). */
export function ClaimPreview() {
  const q = useSearchParams().get('case');
  const name: FixtureName = (q && q in FIXTURES ? q : 'happy') as FixtureName;
  return <ClaimPanel api={FIXTURES[name]()} />;
}

declare global {
  interface Window {
    __claimCalls?: { discover: number; preview: number; attempt: number; report: number; rollback: number };
  }
}

/** Dev-only counting wrapper: lets behavioral tests prove WHEN fetches happen. */
const counting = (api: ClaimApi): ClaimApi => {
  const c = (window.__claimCalls ??= { discover: 0, preview: 0, attempt: 0, report: 0, rollback: 0 });
  return {
    preview: () => (c.preview++, api.preview()),
    attempt: () => (c.attempt++, api.attempt()),
    report: (id) => (c.report++, api.report(id)),
    rollback: (id) => (c.rollback++, api.rollback(id)),
  };
};

/**
 * The /account SECTION surface (?surface=section&case=...&discovery=on|off|error):
 * drives ClaimSection with fixture discovery + a counting fixture api, so tests
 * can prove no claim fetch happens while off or before explicit initiation.
 */
export function ClaimSectionPreview() {
  const sp = useSearchParams();
  const caze = sp.get('case');
  const name: FixtureName = (caze && caze in FIXTURES ? caze : 'happy') as FixtureName;
  const mode = sp.get('discovery') ?? 'on';
  const discover = async () => {
    const c = (window.__claimCalls ??= { discover: 0, preview: 0, attempt: 0, report: 0, rollback: 0 });
    c.discover++;
    if (mode === 'error') throw new Error('discovery failed');
    return mode === 'on';
  };
  return <ClaimSection discover={discover} makeApi={() => counting(FIXTURES[name]())} />;
}

/** The dev page entry: ?surface=section renders the /account section surface,
 *  anything else renders the bare panel. */
export function ClaimDevSurface() {
  const surface = useSearchParams().get('surface');
  return surface === 'section' ? <ClaimSectionPreview /> : <ClaimPreview />;
}
