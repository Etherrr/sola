import Link from 'next/link';
import type { ReactNode } from 'react';
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <div className="lead">{children}</div>
    </header>
  );
}
export function ActionLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link className={`button ${secondary ? 'secondary' : 'primary'}`} href={href}>
      {children}
    </Link>
  );
}
export function SimulatedNotice() {
  return (
    <aside className="simulation-notice">
      <span className="badge">SIMULATED</span>
      <span>Educational sample only. No wallet connected. No live data or transactions.</span>
    </aside>
  );
}
