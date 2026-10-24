'use client';
import { useId } from 'react';
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
