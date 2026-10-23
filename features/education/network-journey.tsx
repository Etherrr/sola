'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BASE_FEE_BURNED_ETH, FEE_ETH, FICTIONAL, STEPS, TIP_ETH } from './journey-steps';

const SPEED_MS = 2600;
const QUERY = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const getReduced = () => window.matchMedia(QUERY).matches;

export function NetworkJourney() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReduced, getReduced, () => false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = STEPS.length - 1;

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s >= last) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, SPEED_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, last]);

  const current = STEPS[step]!;
  const stage = (i: number) => (i < step ? 'done' : i === step ? 'now' : 'todo');

  return (
    <section className="journey-scene" aria-labelledby="journey-title">
      <p className="mode-marker mode-simulated" role="note">
        <span className="badge">◇ SIMULATED</span>
        <span>
          Fictional people and addresses. No wallet is used, nothing is sent and no live data is
          read.
        </span>
      </p>
      <h2 id="journey-title">Follow one Ethereum transfer from start to finish</h2>

      <div className="journey-stage" aria-hidden="true">
        <div className={`j-node j-from ${step <= 1 ? 'active' : ''}`}>
          <strong>{FICTIONAL.from.name}</strong>
          <small>{FICTIONAL.from.address}</small>
        </div>
        <div className="j-track">
          <span className="j-line" />
          <span className="j-packet" style={{ ['--p' as string]: `${Math.min(step, 4) * 25}%` }} />
        </div>
        <div className={`j-node j-chain ${step >= 2 && step <= 5 ? 'active' : ''}`}>
          <strong>The network</strong>
          <small>{step < 3 ? 'pool of pending transfers' : 'blocks, linked in order'}</small>
          <span className="j-blocks">
            {[0, 1, 2].map((b) => (
              <i key={b} className={step >= 3 && b <= Math.min(step - 3, 2) ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div className="j-track">
          <span className="j-line" />
        </div>
        <div className={`j-node j-to ${step >= 3 ? 'active' : ''}`}>
          <strong>{FICTIONAL.to.name}</strong>
          <small>{FICTIONAL.to.address}</small>
        </div>
      </div>

      <div className="journey-controls" role="group" aria-label="Animation controls">
        <button
          className="button primary"
          type="button"
          onClick={() => {
            if (step >= last) setStep(0);
            setPlaying((p) => !p);
          }}
          aria-pressed={playing}
        >
          {playing ? 'Pause' : step >= last ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          ← Previous
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setPlaying(false);
            setStep((s) => Math.min(last, s + 1));
          }}
          disabled={step === last}
        >
          Next →
        </button>
        <label className="journey-scrub">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${current.title}`}
          />
        </label>
      </div>
      {reducedMotion && (
        <p className="fine">
          Motion is reduced on your device, so use Next and Previous to step through.
        </p>
      )}

      <div className="journey-now" role="status" aria-live="polite">
        <p className="eyebrow">STATUS: {current.status.toUpperCase()}</p>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
      </div>

      <section className="journey-fee" aria-labelledby="fee-title">
        <h3 id="fee-title">The fee, worked out (Ethereum)</h3>
        <p>
          {FICTIONAL.gas.toLocaleString('en-US')} units of gas × ({FICTIONAL.baseFeeGwei} gwei base
          fee + {FICTIONAL.tipGwei} gwei tip) = <strong>{FEE_ETH} ETH</strong>. Of that,{' '}
          {BASE_FEE_BURNED_ETH} ETH is the base fee that is burned and {TIP_ETH} ETH is the tip to
          the validator. Alex set a 15 gwei maximum and a 2 gwei tip. The network’s base fee was 10
          gwei, so the total was 12 gwei per unit, under the maximum. Real base fees change every
          block. These numbers are an example.
        </p>
      </section>

      <section aria-labelledby="text-alt">
        <h3 id="text-alt">The same journey as text</h3>
        <ol className="journey-text">
          {STEPS.map((s, i) => (
            <li key={s.id} className={stage(i)} aria-current={i === step ? 'step' : undefined}>
              <strong>{s.title}.</strong> <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
