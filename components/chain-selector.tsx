'use client';
import { useId } from 'react';
import { usePathname } from 'next/navigation';
import { useTrackNetwork } from '@/features/portfolio/track-network-context';
import type { TrackNetwork } from '@/features/portfolio/api-client';
// Networks the Track lookup actually reads today. Unsupported chains are not listed here at all:
// a control that offers networks it cannot read would contradict the result it sits above.
export const TRACK_NETWORKS: { id: TrackNetwork; label: string }[] = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'solana', label: 'Solana (SOL only)' },
];
export function ChainSelector() {
  const id = useId();
  const path = usePathname();
  const { network, setNetwork } = useTrackNetwork();
  // The portfolio overview and the demo pages are all-networks views: neither takes a
  // network selection, and any chip there would read as page scope it does not have. The
  // selector only appears where a network actually applies.
  if (path.startsWith('/portfolio') || path.startsWith('/demo')) return null;
  if (!path.startsWith('/track')) return <span className="scope-chip">Sola Lens preview</span>;
  return (
    <div className="chain-select">
      <label htmlFor={id}>Network</label>
      <select
        id={id}
        value={network}
        onChange={(e) => setNetwork(e.target.value as TrackNetwork)}
        aria-describedby={`${id}-note`}
      >
        {TRACK_NETWORKS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <span id={`${id}-note`} className="sr-only">
        Applies to the address lookup below and matches the network chips in the form. Ethereum
        reads ETH and a short list of tokens; Solana reads the SOL balance only.
      </span>
    </div>
  );
}
