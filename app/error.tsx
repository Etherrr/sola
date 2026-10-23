'use client';
import Link from 'next/link';
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-container narrow" role="alert">
      <p className="eyebrow">A PAUSE IN THE VIEW</p>
      <h1>This view could not load.</h1>
      <p>
        Try again, or return to the welcome screen. No wallet or financial activity is involved.
      </p>
      <div className="actions">
        <button className="button primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="button secondary">
          Return home
        </Link>
      </div>
    </div>
  );
}
