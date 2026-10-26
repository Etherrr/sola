'use client';
import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Compatibility stub for a lesson route that moved under the ONE /learn/* shell (plan §8).
 * On the static export there is no server to issue a redirect locally, so this page
 * redirects in the client and shows a real link for no-JS and assistive technology; the
 * Cloudflare Pages deployment additionally answers a true 308 via public/_redirects
 * (verified on the preview deployment, not assumed from documentation).
 */
export function MovedPage({ to, title }: { to: string; title: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return (
    <div className="page-container narrow">
      <h1>This lesson has moved</h1>
      <p>
        {title} now lives at <Link href={to}>{to}</Link>. Taking you there now.
      </p>
    </div>
  );
}
