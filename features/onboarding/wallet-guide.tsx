'use client';
import { useState } from 'react';
import { officialLinks, reviewedOn } from '@/lib/official-links';
export function WalletGuide() {
  const [choice, setChoice] = useState('learn');
  return (
    <section className="panel">
      <p className="eyebrow">YOUR DECISION GUIDE</p>
      <h2>What would you like to understand?</h2>
      <fieldset>
        <legend>Choose a starting point</legend>
        {[
          ['learn', 'I’m exploring — no setup yet'],
          ['software', 'A browser or mobile interface'],
          ['hardware', 'Keeping keys on a separate device'],
        ].map(([value, label]) => (
          <label className="answer" key={value}>
            <input
              type="radio"
              name="wallet-guide"
              value={value}
              checked={choice === value}
              onChange={() => setChoice(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p role="status">
        {choice === 'learn'
          ? 'Stay in the demo. You do not need a wallet or device to learn.'
          : choice === 'software'
            ? 'Research software interfaces such as MetaMask and NuFi. Check the current supported networks, platform, backup process, and privacy policy.'
            : 'Research hardware products such as OneKey and Ledger. Check device authenticity, recovery practices, and compatibility with your chosen interface.'}
      </p>
      <p className="muted">
        Candidates, not endorsements. Sola has not certified any wallet combination. No download or
        purchase is required.
      </p>
      <div className="resource-grid">
        {officialLinks.slice(0, 4).map((link) => (
          <a
            className="resource"
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.name} ↗<small>{link.type} · external official site</small>
          </a>
        ))}
      </div>
      <p className="fine">
        Sources reviewed {reviewedOn}. Review current versions and compatibility directly with each
        vendor.
      </p>
    </section>
  );
}
