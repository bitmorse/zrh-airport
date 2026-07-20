import type { TrailPoint } from "../data/watchStore";

const W = 120;
const H = 28;
const PAD = 2;

/** A tiny altitude-vs-time trace for a watched flight's trajectory (nulls skipped). */
export function AltitudeSparkline({ trajectory }: { trajectory: TrailPoint[] }) {
  const alts = trajectory.map((p) => p.alt).filter((a): a is number => a != null);
  if (alts.length < 2) {
    return <span className="text-[10px] text-slate-600">no altitude</span>;
  }
  const min = Math.min(...alts);
  const max = Math.max(...alts);
  const span = Math.max(1, max - min);
  const n = alts.length;
  const d = alts
    .map((a, i) => {
      const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
      const y = PAD + (1 - (a - min) / span) * (H - 2 * PAD);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-5 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Altitude trace"
    >
      <path
        d={d}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
