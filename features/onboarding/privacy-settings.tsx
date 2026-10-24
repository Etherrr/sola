'use client';
import { useProgress } from './progress-provider';
export function PrivacySettings() {
  const { completed, enabled, notice, toggle, clear } = useProgress();
  return (
    <section className="panel">
      <h2>Your progress, your choice</h2>
      <p>
        Optional saving stores only completed lesson IDs in this browser under{' '}
        <code>sola-lens.progress.v1</code>. No account, addresses, wallet details, or analytics are
        collected by this app.
      </p>
      <p>
        Separately, the entrance animation keeps one flag, <code>sola-welcomed</code>, in this
        browser&apos;s session storage so it shows once per session. It is cleared when you close
        the tab and holds nothing about you.
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
