import { useAirport } from "../hooks/useAirport";
import type { LatLon } from "../lib/geo";
import { metersToSvg, projectToSvg, SVG_H, SVG_W } from "../lib/projection";

const PAD = 12;
const BLUE = "#3b82f6";

/**
 * "You are here": the observer's GPS location on the map, with a heading cone (the
 * direction the phone is facing, from the compass) and — only while a clip is
 * actively recording — the auto-record geofence ring. Non-interactive; pans/zooms
 * with the map. When the user is outside the mapped area the marker is clamped to the
 * nearest edge and dimmed, and the ring is omitted.
 */
export function UserLayer({
  userPos,
  heading,
  radiusM,
  recording,
}: {
  userPos: LatLon;
  heading: number | null;
  radiusM: number;
  recording: boolean;
}) {
  const { arp } = useAirport().config;
  const raw = projectToSvg(arp, userPos);
  const x = Math.max(PAD, Math.min(SVG_W - PAD, raw.x));
  const y = Math.max(PAD, Math.min(SVG_H - PAD, raw.y));
  const offMap = x !== raw.x || y !== raw.y;

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Geofence ring — geographic radius, shown only while recording and on-map. */}
      {recording && !offMap && radiusM > 0 && (
        <circle
          cx={raw.x}
          cy={raw.y}
          r={metersToSvg(radiusM)}
          fill={BLUE}
          fillOpacity={0.06}
          stroke={BLUE}
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={offMap ? 0.5 : 1}>
        {/* Facing cone (compass heading), pointing north before rotation. */}
        {heading != null && !offMap && (
          <g transform={`rotate(${heading.toFixed(0)})`}>
            <path d="M0,0 L-5,-17 L5,-17 Z" fill={BLUE} fillOpacity={0.35} />
          </g>
        )}
        {/* Location dot. */}
        <circle r={5} fill={BLUE} stroke="#e5e7eb" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </g>
    </g>
  );
}
