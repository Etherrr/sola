'use client';
import { useId } from 'react';
import { usePathname } from 'next/navigation';
// Only Ethereum has any (simulated) support. Other chains are listed so the roadmap is honest,
// but they are disabled and carry no data.
export const CHAINS = [
  { id: 'ethereum', label: 'Ethereum', supported: true },
  { id: 'solana', label: 'Solana', supported: false },
  { id: 'base', label: 'Base', supported: false },
  { id: 'arbitrum', label: 'Arbitrum', supported: false },
] as const;
export function ChainSelector() {
  const id = useId();
  const path = usePathname();
  // The overview demo spans invented Ethereum and Solana holdings, so a network filter there
  // would be misleading. The selector only appears where a network actually applies.
  if (path.startsWith('/portfolio')) return <span className="scope-chip">Demo · all networks</span>;
  if (!path.startsWith('/track')) return <span className="scope-chip">Sola Lens preview</span>;
  return (
    <div className="chain-select">
      <label htmlFor={id}>Network</label>
      <select id={id} value="ethereum" onChange={() => undefined} aria-describedby={`${id}-note`}>
        {CHAINS.map((c) => (
          <option key={c.id} value={c.id} disabled={!c.supported}>
            {c.supported ? c.label : `${c.label} · not supported yet`}
          </option>
        ))}
      </select>
      <span id={`${id}-note`} className="sr-only">
        Only Ethereum is available, with simulated data. Other networks are not supported yet.
      </span>
    </div>
  );
}
