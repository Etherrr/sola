'use client';
import { useEffect, useState } from 'react';
import { ClaimPanel } from './claim-panel';
import { claimApiFetch, type ClaimApi } from './claim-api';
import { claimFeaturesRequest } from '../portfolio/api-client';

/**
 * The /account claim SECTION (plan B.3, design v4 open item 4; LOCAL
 * integration prep - uncommitted, unpushed, review pending).
 *
 * Two hard guarantees (reviewer integration requirements):
 *  1. NO CLAIM FETCH WHILE THE FEATURE IS OFF. The section first asks the
 *     discovery endpoint (the only permitted pre-initiation request). A false
 *     or failed answer renders NOTHING - the rendered account page is unchanged
     from before (one added network request: the discovery GET)
 *     to today - and no claim endpoint is ever called.
 *  2. NO AUTOMATIC CLAIM WORK. Even with the feature on, the panel (and its
 *     preview fetch) mounts only on an explicit click. Recovery of an active
 *     claim rides the same explicit path: the returning user opens the
 *     section and the panel recovers report + undo via the R3 mechanism.
 *
 * Both the discovery and the panel api are seams: production wires the real
 * endpoints (claimSectionLive below); the dev preview page injects fixtures.
 */
export type ClaimDiscovery = () => Promise<boolean>;

type Props = {
  discover: ClaimDiscovery;
  makeApi: () => ClaimApi;
};

/** The production seams: real discovery endpoint + real claim endpoints. */
export const claimSectionLive: Props = {
  discover: async () => {
    try {
      const r = await claimFeaturesRequest();
      if (!r.ok) return false;
      const b = (await r.json().catch(() => null)) as { claim?: unknown } | null;
      return b?.claim === true;
    } catch {
      return false;
    }
  },
  makeApi: () => claimApiFetch,
};

export function ClaimSection({ discover, makeApi }: Props) {
  // 'unknown' -> render nothing yet (no flash); false -> render nothing ever.
  const [available, setAvailable] = useState<boolean | 'unknown'>('unknown');
  // The panel api exists only after the explicit click - its mere construction
  // is user-initiated, and the panel's first fetch happens at its mount.
  const [api, setApi] = useState<ClaimApi | null>(null);

  useEffect(() => {
    let live = true;
    discover()
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [discover]);

  if (available !== true) return null;

  if (!api) {
    const bridge = typeof window !== 'undefined' &&
      /^\/account\/legacy-bridge\/?$/.test(window.location.pathname);
    const entry = <div className="panel claim-section">
      <p className="claim-note">
        If you saved addresses before, verify your previous sign-in before importing.
        Nothing moves without your confirmation.
      </p>
      {bridge ? <p className="actions">
        <button type="button" className="button secondary" onClick={() => setApi(makeApi())}>
          Check for saved addresses
        </button>
      </p> : <p><a href="/account/legacy-bridge/">Verify previous sign-in</a></p>}
    </div>;
    return bridge ? entry : <details className="claim-import">
      <summary>Import saved addresses</summary>
      {entry}
    </details>;
  }

  return (
    <div className="panel claim-section">
      <ClaimPanel api={api} />
    </div>
  );
}
