import type { TrailPoint } from "../data/watchStore";
import { useAirport } from "../hooks/useAirport";
import { fitPath } from "../lib/trajectory";

const W = 300;
const H = 200;
const PAD = 16;

/**
 * A small standalone map of one stored flight trajectory, fit to its own box (via
 * `fitPath`), with the airport's runway centrelines projected into the same space for
 * context. Green marks the path start, red the end.
 */
export function TrajectoryMap({ trajectory }: { trajectory: TrailPoint[] }) {
  const { strips } = useAirport();
  if (trajectory.length < 2) {
    return <p className="text-xs text-muted">No trajectory recorded for this flight.</p>;
  }
  const { pts, project } = fitPath(trajectory, W, H, PAD);
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const start = pts[0];
  const end = pts[pts.length - 1];
  const inBox = (p: { x: number; y: number }) =>
    p.x >= -30 && p.x <= W + 30 && p.y >= -30 && p.y <= H + 30;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full border border-border bg-surface-container-lowest"
      role="img"
      aria-label="Flight trajectory map"
    >
      {strips.map((s) => {
        const a = project(s.a);
        const b = project(s.b);
        if (!inBox(a) && !inBox(b)) return null;
        return (
          <line
            key={s.name}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--color-outline-variant)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}
      <path
        d={d}
        fill="none"
        stroke="var(--color-status-arrival)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <rect x={start.x - 3.5} y={start.y - 3.5} width={7} height={7} fill="var(--color-status-cleared)" />
      <rect x={end.x - 3.5} y={end.y - 3.5} width={7} height={7} fill="var(--color-status-alert)" />
    </svg>
  );
}
