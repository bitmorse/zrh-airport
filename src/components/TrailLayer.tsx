import type { Aircraft } from "../data/adsb";
import { useAirport } from "../hooks/useAirport";
import { useSmoothClock } from "../hooks/useSmoothClock";
import type { LatLon } from "../lib/geo";
import { projectToSvg } from "../lib/projection";
import { reckonPosition } from "../lib/reckon";

type TrailAircraft = Pick<Aircraft, "lat" | "lon" | "onGround" | "gs" | "track" | "seenPos">;

/**
 * The selected aircraft's trajectory — its recent position history drawn as a
 * polyline (oldest → newest). The leading end is dead-reckoned to the aircraft's
 * live position (same as the plane glyph) and animated, so the trail stays attached
 * to the moving icon instead of lagging a poll behind. Non-interactive; under the
 * glyphs.
 */
export function TrailLayer({
  points,
  ac,
  lastUpdated,
}: {
  points: LatLon[];
  ac?: TrailAircraft;
  lastUpdated: number | null;
}) {
  const { arp } = useAirport().config;
  const now = useSmoothClock(120);

  const verts: LatLon[] = ac ? [...points, reckonPosition(ac, lastUpdated, now)] : points;
  if (verts.length < 2) return null;

  const d = verts
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
