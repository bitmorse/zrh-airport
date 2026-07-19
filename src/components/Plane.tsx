import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { projectToSvg, inViewport } from "../lib/projection";

const PHASE_COLOR: Record<string, string> = {
  approach: "#38bdf8", // sky — arriving
  runway: "#e5e7eb", // near-white — on/over the runway
  departure: "#fbbf24", // amber — climbing out
};

/**
 * A single aircraft, drawn as a small plane glyph pointing along its track.
 * Aircraft attributed to a runway are tinted by flight phase; others are dim.
 */
export function Plane({ item }: { item: AircraftWithAssignment }) {
  const { ac, assignment } = item;
  const pt = projectToSvg({ lat: ac.lat, lon: ac.lon });
  if (!inViewport(pt, 20)) return null;

  const heading = ac.track ?? 0;
  const color = assignment ? PHASE_COLOR[assignment.phase] : "#64748b";
  const active = assignment !== null;
  const label = ac.flight ?? ac.hex.toUpperCase();

  return (
    <g
      transform={`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`}
      opacity={active ? 1 : 0.5}
    >
      <g transform={`rotate(${heading.toFixed(0)})`}>
        {/* Plane glyph pointing "up" = north = track 0. */}
        <path
          d="M0,-7 L2.2,-1 L2.2,1.5 L0,0.5 L-2.2,1.5 L-2.2,-1 Z M0,0.5 L1.6,4 L1.6,5 L0,4.2 L-1.6,5 L-1.6,4 Z"
          fill={color}
          stroke="#0b1120"
          strokeWidth={0.4}
        />
      </g>
      {active && (
        <text
          x={6}
          y={3}
          fontSize={7}
          fill={color}
          className="select-none"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
