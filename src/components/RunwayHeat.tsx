import type { RunwayEnd } from "../domain/airport";
import { useAirport } from "../hooks/useAirport";
import { heatColor } from "../lib/heat";
import { projectToSvg, type Point } from "../lib/projection";

const BASE_WIDTH = 9;
const END_WIDTH = 15;
const END_FRACTION = 0.3; // portion of the strip length the touchdown zone covers

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function RunwayEndZone({
  end,
  count,
  ta,
  tb,
}: {
  end: RunwayEnd;
  count: number;
  ta: Point; // this end's threshold (svg)
  tb: Point; // far end threshold (svg)
}) {
  const zoneEnd = lerp(ta, tb, END_FRACTION);
  const color = heatColor(count);

  // Runway number painted on the surface just inside the threshold, like a real
  // runway designation marking: oriented to read from the approach (the glyphs
  // point up the runway, ta → tb), so the two ends face opposite ways as they do
  // in life. Rotating (0,-1) — SVG text's "up" — onto the ta→tb axis gives the angle.
  const label = lerp(ta, tb, 0.11);
  const angleDeg =
    (Math.atan2(tb.x - ta.x, -(tb.y - ta.y)) * 180) / Math.PI;
  const fontSize = end.id.length >= 3 ? 6.5 : 9;

  return (
    <g>
      <line
        x1={ta.x}
        y1={ta.y}
        x2={zoneEnd.x}
        y2={zoneEnd.y}
        stroke={color}
        strokeWidth={END_WIDTH}
        strokeLinecap="butt"
      />
      <text
        x={label.x}
        y={label.y}
        transform={`rotate(${angleDeg.toFixed(1)} ${label.x.toFixed(1)} ${label.y.toFixed(1)})`}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        letterSpacing="0.5"
        fill="var(--color-surface-container-lowest)"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {end.id}
      </text>
    </g>
  );
}

/**
 * One physical runway strip with both ends heat-coloured by their 15-minute
 * distinct-aircraft counts.
 */
export function RunwayHeat({
  ends,
  counts,
}: {
  ends: [RunwayEnd, RunwayEnd];
  counts: Record<string, number>;
}) {
  const [e0, e1] = ends;
  const { arp } = useAirport().config;
  const t0 = projectToSvg(arp, e0.threshold);
  const t1 = projectToSvg(arp, e1.threshold);

  return (
    <g>
      {/* Base strip. */}
      <line
        x1={t0.x}
        y1={t0.y}
        x2={t1.x}
        y2={t1.y}
        stroke="var(--color-outline)"
        strokeWidth={BASE_WIDTH}
        strokeLinecap="butt"
      />
      <RunwayEndZone end={e0} count={counts[e0.id] ?? 0} ta={t0} tb={t1} />
      <RunwayEndZone end={e1} count={counts[e1.id] ?? 0} ta={t1} tb={t0} />
    </g>
  );
}
