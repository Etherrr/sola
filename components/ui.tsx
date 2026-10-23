import Link from 'next/link';
import type { ReactNode } from 'react';
import { ModeMarker } from './mode-marker';
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
  return <ModeMarker mode="SIMULATED" />;
}
