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

  // Label sits outside the threshold, along the runway axis. Pushing it well
  // clear of the strip also separates the 14 & 16 badges, whose thresholds are
  // close together but whose axes diverge.
  const outward = lerp(ta, tb, -0.14);

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
      <g transform={`translate(${outward.x.toFixed(1)} ${outward.y.toFixed(1)})`}>
        {/* Square end-ID badge (rectilinear, per design). */}
        <rect
          x={-10.5}
          y={-10.5}
          width={21}
          height={21}
          fill="var(--color-inverse-surface)"
          stroke={color}
          strokeWidth={1.5}
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={700}
          fill="var(--color-inverse-on-surface)"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {end.id}
        </text>
        {count > 0 && (
          <text
            textAnchor="middle"
            y={19}
            fontSize={8.5}
            fontWeight={700}
            fill={color}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {count}
          </text>
        )}
      </g>
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
