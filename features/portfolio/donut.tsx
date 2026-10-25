export type Slice = {
  label: string;
  key?: string;
  percent: number;
  color: string;
  /** True when the true share rounds to 0.0% - the legend/aria must say '<0.1', never '0'. */
  roundedZero?: boolean;
  /** Exact raw fraction (0..1) for geometry; falls back to percent/100. A sub-0.05% slice
   *  keeps its true raw-ratio arc instead of collapsing to zero from the rounded display. */
  share?: number;
};
const R = 42;
const C = 2 * Math.PI * R;
/** Dependency-free SVG donut. The meaning is carried by the aria-label and the adjacent list, not by colour. */
export function Donut({
  slices,
  caption,
  center,
}: {
  slices: Slice[];
  caption: string;
  /** Optional center text replacing the slice count (e.g. '1 chain'). */
  center?: string;
}) {
  const lens = slices.map((s) => Math.max(0, Math.min(1, s.share ?? s.percent / 100)) * C);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((x, y) => x + y, 0));
  const pct = (s: Slice) => (s.roundedZero ? '<0.1' : `${s.percent}`);
  const label = slices.map((s) => `${s.label} ${pct(s)} percent`).join(', ');
  return (
    <svg className="donut" viewBox="0 0 100 100" role="img" aria-label={`Allocation: ${label}`}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
      {slices.map((s, i) => {
        const len = lens[i]!;
        const el = (
          <circle
            key={s.key ?? s.label}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="12"
            // A single full ring needs no gap; the 0.6 hairline only separates adjacent
          // slices. Never subtract the gap from an arc smaller than the gap itself: a true
          // 0.1% arc is 0.26px and would round to nothing - draw it at its true size.
          strokeDasharray={`${slices.length > 1 && len > 0.6 ? len - 0.6 : len} ${C}`}
            strokeDashoffset={-starts[i]!}
            transform="rotate(-90 50 50)"
          />
        );
        return el;
      })}
      <text
        x="50"
        y={caption === '' ? 53 : 48}
        textAnchor="middle"
        className={center !== undefined ? 'donut-c' : 'donut-n'}
      >
        {center ?? slices.length}
      </text>
      <text x="50" y="60" textAnchor="middle" className="donut-c">
        {caption}
      </text>
    </svg>
  );
}
