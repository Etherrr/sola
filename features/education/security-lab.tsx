'use client';
import { useState } from 'react';
import { SCENARIOS, SOURCES, VERDICT_LABEL } from './security-lab-data';

export function SecurityLab() {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const done = SCENARIOS.filter((s) => revealed[s.id]).length;

  return (
    <section className="lab" aria-labelledby="lab-title">
      <p className="mode-marker mode-simulated" role="note">
        <span className="badge">◇ SIMULATED</span>
        <span>
          Invented prompts for practice. No wallet is used. Your answers stay in this page’s memory
          only: they are not typed, saved or sent anywhere.
        </span>
      </p>
      <h2 id="lab-title">Four decisions, with the consequence shown right here</h2>
      <p className="fine" role="status">
        {done} of {SCENARIOS.length} scenarios answered. This count lasts only for this visit.
      </p>
      {SCENARIOS.map((s, index) => {
        const choice = s.choices.find((c) => c.id === picked[s.id]);
        const shown = Boolean(revealed[s.id] && choice);
        return (
          <fieldset className="lab-card" key={s.id}>
            <legend>
              <span className="eyebrow">
                {index + 1} OF {SCENARIOS.length} · {s.kind.toUpperCase()}
              </span>
              <span className="lab-title">{s.title}</span>
            </legend>
            <div className="lab-seen">
              <p className="eyebrow">WHAT YOU SEE</p>
              <ul>
                {s.seen.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="lab-q">{s.question}</p>
            <div className="lab-options" role="radiogroup" aria-label={`${s.title}: choose one`}>
              {s.choices.map((c) => (
                <label key={c.id} className="lab-option">
                  <input
                    type="radio"
                    name={`lab-${s.id}`}
                    value={c.id}
                    checked={picked[s.id] === c.id}
                    disabled={shown}
                    onChange={() => setPicked((p) => ({ ...p, [s.id]: c.id }))}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <div className="lab-actions">
              <button
                className="button primary"
                type="button"
                disabled={!choice || shown}
                onClick={() => setRevealed((r) => ({ ...r, [s.id]: true }))}
              >
                Check my choice
              </button>
              {shown && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={(e) => {
                    const card = e.currentTarget.closest('fieldset');
                    setRevealed((r) => ({ ...r, [s.id]: false }));
                    requestAnimationFrame(() =>
                      card?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus(),
                    );
                    setPicked((p) => {
                      const next = { ...p };
                      delete next[s.id];
                      return next;
                    });
                  }}
                >
                  Try again
                </button>
              )}
            </div>
            <div className="lab-result" role="status" aria-live="polite">
              {shown && choice && (
                <div className={`lab-outcome verdict-${choice.verdict}`}>
                  <p className="eyebrow">{VERDICT_LABEL[choice.verdict].toUpperCase()}</p>
                  <p>{choice.outcome}</p>
                  <p>
                    <strong>Safer habit:</strong> {s.saferAction}
                  </p>
                </div>
              )}
            </div>
          </fieldset>
        );
      })}
      <p className="notice">
        These scenarios describe common patterns on Ethereum-style wallets. Wallets differ in how
        they word prompts, and Bitcoin and Solana wallets work differently. This is education, not a
        complete list of scams or financial advice. Sources:{' '}
        {SOURCES.map((src, i) => (
          <span key={src.href}>
            {i > 0 ? ', ' : ''}
            <a href={src.href} target="_blank" rel="noopener noreferrer">
              {src.label}
            </a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}
