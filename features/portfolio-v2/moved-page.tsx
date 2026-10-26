'use client';
import Link from 'next/link';
import { useEffect } from 'react';
/** Old sample-view bookmarks resume the real native account view, never fixture data. */
export function PortfolioMovedPage({ to, title }: { to: string; title: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return (
    <div className="page-container narrow">
      <h1>{title}</h1>
      <p>
        This view is part of your Sola account. <Link href={to}>Continue to {title}</Link>.
      </p>
    </div>
  );
}
