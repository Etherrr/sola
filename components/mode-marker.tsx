export const MODES = {
  SIMULATED: {
    label: 'SIMULATED',
    symbol: '◇',
    text: 'Simulated sample only. No wallet connected. No live data or transactions.',
  },
  LIVE_CACHED: {
    label: 'LIVE · CACHED',
    symbol: '●',
    text: 'Real public data read earlier and stored briefly. Check the time shown.',
  },
  LIVE_REFRESHED: {
    label: 'LIVE · REFRESHED',
    symbol: '●',
    text: 'Real public data read just now. Read-only: nothing connects, signs or moves.',
  },
  STALE: {
    label: 'STALE',
    symbol: '◌',
    text: 'This data is older than it should be. Refresh before relying on it.',
  },
  INCOMPLETE: {
    label: 'INCOMPLETE',
    symbol: '◐',
    text: 'Some data could not be read. Missing data is not a zero balance.',
  },
} as const;

export type Mode = keyof typeof MODES;

/** Persistent mode marker. Meaning is carried by text and a symbol, never by colour alone. */
export function ModeMarker({
  mode,
  note,
  context,
}: {
  mode: Mode;
  note?: string;
  context?: string;
}) {
  const m = MODES[mode];
  return (
    <aside
      className={`mode-marker mode-${mode.toLowerCase().replace('_', '-')}`}
      aria-label={`Data mode: ${m.label}${context ? ` (${context})` : ''}`}
    >
      <span className="badge">
        <span aria-hidden="true">{m.symbol} </span>
        {m.label}
      </span>
      <span>{note ?? m.text}</span>
    </aside>
  );
}
