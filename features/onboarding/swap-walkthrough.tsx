'use client';
import { useState } from 'react';
const steps = [
  {
    title: 'Understand the pair',
    body: 'Example only: 1 SOL → 150 USDC at an invented rate. Token identity matters; matching symbols alone do not establish the same asset.',
  },
  {
    title: 'Inspect the quote',
    body: 'Illustrative output: 150 USDC before fees. At 1% slippage tolerance, the illustrative minimum is 148.50 USDC before separately modeled costs. This is arithmetic, not a current market quote.',
  },
  {
    title: 'Review the risks',
    body: 'Review token identity, route, price impact, minimum received, and network costs. A real swap would require signing. This learning exercise ends here.',
  },
];
export function SwapWalkthrough() {
  const [step, setStep] = useState(0);
  return (
    <section className="panel swap">
      <span className="badge">SIMULATED EXERCISE</span>
      <h2>Walk through a quote</h2>
      <div className="swap-pair">
        <span>1 SOL</span>
        <span aria-hidden="true">→</span>
        <span>150 USDC</span>
      </div>
      <div aria-live="polite">
        <p className="eyebrow">STEP {step + 1} OF 3</p>
        <h3>{steps[step].title}</h3>
        <p>{steps[step].body}</p>
      </div>
      <div className="actions">
        <button
          className="button secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Previous step
        </button>
        <button className="button primary" onClick={() => setStep(step === 2 ? 0 : step + 1)}>
          {step === 2 ? 'Restart exercise' : 'Next step'}
        </button>
      </div>
      <p className="fine">No live quotes, approvals, fees charged, or tokens moved.</p>
    </section>
  );
}
