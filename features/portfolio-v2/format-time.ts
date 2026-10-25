/**
 * Human-readable observation times for v0.2 panels: locale date + time WITH
 * timezone name, so a wall time is never ambiguous. The exact ISO instant
 * stays available in a title attribute - source/time semantics unchanged
 * (the time shown is still the provider's own observation time).
 */
export function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
