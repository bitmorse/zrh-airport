import { useAirport } from "../hooks/useAirport";
import type { LatLon } from "../lib/geo";
import { projectToSvg } from "../lib/projection";

/**
 * The selected aircraft's trajectory — its recent position history drawn as a
 * fading polyline (oldest → newest). Non-interactive; sits under the plane glyphs.
 */
export function TrailLayer({ points }: { points: LatLon[] }) {
  const { arp } = useAirport().config;
  if (points.length < 2) return null;

  const d = points
    .map((p, i) => {
      const pt = projectToSvg(arp, p);
      return `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <g style={{ pointerEvents: "none" }}>
      <path
        d={d}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={2.5}
        strokeOpacity={0.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
}
