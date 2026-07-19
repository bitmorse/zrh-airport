import type { RunwayEnd } from "../domain/runways";
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

  // Label sits just outside the threshold, along the runway axis.
  const outward = lerp(ta, tb, -0.09);

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
        <circle r={10.5} fill="#0b1120" stroke={color} strokeWidth={1.5} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={700}
          fill="#e5e7eb"
          style={{ fontFamily: "ui-monospace, monospace" }}
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
            style={{ fontFamily: "ui-monospace, monospace" }}
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
  const t0 = projectToSvg(e0.threshold);
  const t1 = projectToSvg(e1.threshold);

  return (
    <g>
      {/* Base strip. */}
      <line
        x1={t0.x}
        y1={t0.y}
        x2={t1.x}
        y2={t1.y}
        stroke="#334155"
        strokeWidth={BASE_WIDTH}
        strokeLinecap="butt"
      />
      <RunwayEndZone end={e0} count={counts[e0.id] ?? 0} ta={t0} tb={t1} />
      <RunwayEndZone end={e1} count={counts[e1.id] ?? 0} ta={t1} tb={t0} />
    </g>
  );
}
