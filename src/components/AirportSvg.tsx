import { memo } from "react";
import { RUNWAY_END_BY_ID, type RunwayEnd } from "../domain/runways";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { SVG_W, SVG_H } from "../lib/projection";
import { Plane } from "./Plane";
import { RunwayHeat } from "./RunwayHeat";

const STRIP_PAIRS: [RunwayEnd, RunwayEnd][] = [
  [RUNWAY_END_BY_ID["16"], RUNWAY_END_BY_ID["34"]],
  [RUNWAY_END_BY_ID["14"], RUNWAY_END_BY_ID["32"]],
  [RUNWAY_END_BY_ID["10"], RUNWAY_END_BY_ID["28"]],
];

function AirportSvgImpl({
  aircraft,
  counts,
}: {
  aircraft: AircraftWithAssignment[];
  counts: Record<string, number>;
}) {
  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="h-full w-full"
      role="img"
      aria-label="Schematic map of Zurich Airport runways with live traffic"
    >
      <defs>
        <radialGradient id="field" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#0b1120" />
        </radialGradient>
      </defs>

      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="url(#field)" />

      {/* Range rings around the airport reference point (centre of the frame). */}
      {[0.33, 0.66, 1].map((r) => (
        <circle
          key={r}
          cx={SVG_W / 2}
          cy={SVG_H / 2}
          r={(SVG_H / 2) * r}
          fill="none"
          stroke="#1e293b"
          strokeWidth={1}
          strokeDasharray="4 6"
        />
      ))}

      {/* North arrow. */}
      <g transform={`translate(${SVG_W - 34} 34)`} opacity={0.8}>
        <line x1={0} y1={16} x2={0} y2={-14} stroke="#64748b" strokeWidth={1.5} />
        <path d="M0,-18 L4,-10 L-4,-10 Z" fill="#94a3b8" />
        <text x={0} y={30} textAnchor="middle" fontSize={11} fill="#94a3b8">
          N
        </text>
      </g>

      {STRIP_PAIRS.map((pair) => (
        <RunwayHeat key={pair[0].strip} ends={pair} counts={counts} />
      ))}

      {aircraft.map((item) => (
        <Plane key={item.ac.hex} item={item} />
      ))}
    </svg>
  );
}

// Memoised: the 1 s clock in App re-renders the status text every second, but the
// map only needs to update when traffic data (a new poll) actually changes.
export const AirportSvg = memo(AirportSvgImpl);
