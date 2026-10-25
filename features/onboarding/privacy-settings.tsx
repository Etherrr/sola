'use client';
import { useProgress } from './progress-provider';
export function PrivacySettings() {
  const { completed, enabled, notice, toggle, clear } = useProgress();
  return (
    <section className="panel">
      <h2>Your progress, your choice</h2>
      <p>
        Optional saving stores only completed lesson IDs in this browser under{' '}
        <code>sola-lens.progress.v1</code>. This preference does not save addresses or account
        identity. Track sends pasted public addresses to the lookup service, and to PublicNode when
        live mode is enabled - or, only when PublicNode answers rate limiting, once to Solana's
        public RPC endpoint. A pasted address is kept only if you choose to save it; saved
        addresses persist under your verified sign-in; you can rename or remove them at any
        time. The app
        uses no analytics.
      </p>
      <label className="answer">
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Save lesson progress on this browser
      </label>
      <p>{completed.length} lessons completed. Turning saving off also clears saved progress.</p>
      <button className="button secondary" onClick={clear}>
        Clear all lesson progress
      </button>
      <p role="status">{notice}</p>
    </section>
  );
}
