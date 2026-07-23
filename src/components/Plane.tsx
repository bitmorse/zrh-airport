import type { LatLon } from "../lib/geo";
import type { CurrentWind } from "../data/airportWeather";
import { useAirport } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { projectToSvg, inViewport } from "../lib/projection";
import { isGusty, windComponents } from "../lib/wind";
import { AIRPLANE_PATH } from "./icons";

// Phase colours reference the shared design tokens (no inline hex). On the runway the
// glyph is painted white — like the runway numbers, which stay legible in direct
// sunlight where the dark on-surface tone washed out against the grey strip.
const RUNWAY_COLOR = "var(--color-surface-container-lowest)"; // white paint
const PHASE_COLOR: Record<string, string> = {
  approach: "var(--color-status-arrival)", // arriving
  runway: RUNWAY_COLOR, // on/over the runway
  departure: "var(--color-status-departure)", // climbing out
};
const INACTIVE_COLOR = "var(--color-muted)";
const SELECT_COLOR = "var(--color-status-arrival)";
const LABEL_COLOR = "var(--color-on-surface)";
// Halo separates the glyph from its background: a white outline over the grey runway
// / colours over white elsewhere — but the white runway glyph needs a dark edge.
const HALO_LIGHT = "var(--color-surface-container-lowest)";
const HALO_DARK = "var(--color-on-surface)";
// Crosswind "push" arrow: a neutral environmental force, deliberately not one of the
// arrival/departure phase colours so it reads as wind, not flight state.
const WIND_COLOR = "var(--color-on-surface-variant)";

/**
 * A single aircraft, drawn as a small plane glyph pointing along its track.
 * Tappable to select (with a generous invisible hit area); the selected aircraft
 * gets a ring and always shows its label.
 */
export function Plane({
  item,
  pos,
  selected,
  searched,
  estimated,
  onSelect,
  wind,
}: {
  item: AircraftWithAssignment;
  /** Optional dead-reckoned position; falls back to the aircraft's last fix. */
  pos?: LatLon;
  selected?: boolean;
  /** This is the flight the user searched for — gets a little extra attention. */
  searched?: boolean;
  /** Position is a guess (last-seen this session or the route origin), not a live fix. */
  estimated?: boolean;
  onSelect?: (hex: string) => void;
  /** Current airport wind (from the optional overlay); undefined = overlay off. */
  wind?: CurrentWind | null;
}) {
  const { ac, assignment } = item;
  const { arp } = useAirport().config;
  const pt = projectToSvg(arp, pos ?? { lat: ac.lat, lon: ac.lon });
  // The selected/searched plane always draws — it may sit far outside the field world
  // (a searched flight hundreds of km away), which the cull would otherwise hide.
  if (!selected && !searched && !inViewport(pt, 20)) return null;

  // Prefer the computed display heading (trail-derived on the ground, where `track` is
  // unreliable); fall back to the raw track, then north.
  const heading = item.heading ?? ac.track ?? 0;
  const onRunway = assignment?.phase === "runway";
  const color = assignment ? PHASE_COLOR[assignment.phase] : INACTIVE_COLOR;
  const halo = onRunway ? HALO_DARK : HALO_LIGHT;
  // Keep the label dark (legible on the light map) when the glyph itself is white.
  const labelColor = selected || onRunway ? LABEL_COLOR : color;
  const active = assignment !== null;
  const show = active || selected || searched;
  const label = ac.flight ?? ac.hex.toUpperCase();

  // Crosswind "push" arrow — only for active aircraft (near the field, where surface
  // wind actually matters) and only when the overlay supplies wind. The trig is a few
  // ops; nothing renders when the overlay is off, so it stays off the hot path.
  const cross =
    wind && active ? windComponents(heading, wind.dirDeg, wind.kt) : null;
  // Ignore a trivial crosswind (aligned / near-calm) — no arrow to add noise.
  const showArrow = cross !== null && cross.crossKt >= 2;
  const gusty = wind ? isGusty(wind.kt, wind.gustKt) : false;
  // The shaft starts just outside the glyph; its length scales with the crosswind but
  // is floored so even a light crosswind draws a readable stick (not a tiny nub) and
  // capped so a gale can't run off the glyph.
  const arrowStart = 8;
  const arrowLen = cross ? Math.max(7, Math.min(cross.crossKt * 0.9, 24)) : 0;
  const arrowTip = arrowStart + arrowLen;
  // The shaft stops at the arrowhead's base (the head is 5 units long), tucked one unit
  // under it so there's no gap. Running it to the tip instead let the round line-caps —
  // especially the wide casing — poke out past the point.
  const shaftEnd = arrowTip - 4;

  return (
    <g
      transform={`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`}
      opacity={estimated ? 0.55 : show ? 1 : 0.5}
      style={{ cursor: onSelect ? "pointer" : undefined }}
      onPointerDown={
        onSelect
          ? (e) => {
              e.stopPropagation(); // don't start a map drag
              onSelect(ac.hex);
            }
          : undefined
      }
    >
      {/* Generous, invisible tap target. */}
      <circle r={10} fill="transparent" />
      {/* Crosswind push: an arrow beside the glyph pointing the way the wind shoves the
          aircraft, its length scaled to the crosswind strength and dashed when the air
          is gusty (bumpy). A light casing keeps it legible over the grey runway strips.
          Drawn before the glyph so the plane sits on top of the shaft's base. */}
      {showArrow && cross && (
        <g transform={`rotate(${(cross.pushDeg - 90).toFixed(0)})`} aria-hidden="true">
          <line
            x1={arrowStart}
            y1={0}
            x2={shaftEnd}
            y2={0}
            stroke={HALO_LIGHT}
            strokeWidth={3.6}
            strokeLinecap="round"
            opacity={0.9}
          />
          <line
            x1={arrowStart}
            y1={0}
            x2={shaftEnd}
            y2={0}
            stroke={WIND_COLOR}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeDasharray={gusty ? "2.5 2.5" : undefined}
          />
          <path
            d={`M${arrowTip.toFixed(1)} 0 L${(arrowTip - 5).toFixed(1)} -3.2 L${(arrowTip - 5).toFixed(1)} 3.2 Z`}
            fill={WIND_COLOR}
            stroke={HALO_LIGHT}
            strokeWidth={1}
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        </g>
      )}
      {/* A little extra attention on the searched flight: a soft accent ring around the
          radar target — enough to pick it out, not a beacon. */}
      {searched && (
        <circle r={13} fill="none" stroke={SELECT_COLOR} strokeWidth={1} opacity={0.65} />
      )}
      {/* Radar target: a sharp 1px square boundary (per design, not a circle). Dashed
          when the position is a guess (last-seen / origin), solid for a live fix. */}
      {selected && (
        <rect
          x={-8}
          y={-8}
          width={16}
          height={16}
          fill="none"
          stroke={SELECT_COLOR}
          strokeWidth={1.4}
          strokeDasharray={estimated ? "3 3" : undefined}
        />
      )}
      {/* Airplane glyph (viewBox 0 0 24 24, nose at +x): centre on the origin, scale
          to ~13 units, and rotate so heading 0 (north) points up. A light halo keeps
          it legible over the grey runway strips (on-runway/inactive glyphs would
          otherwise share the strip's tone) as well as the white radar field. */}
      <g transform={`rotate(${(heading - 90).toFixed(0)}) translate(-6.5 -6.5) scale(0.54)`}>
        <path
          d={AIRPLANE_PATH}
          fill={color}
          stroke={halo}
          strokeWidth={2}
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </g>
      {show && (
        <text
          x={9}
          y={3}
          fontSize={7}
          fill={labelColor}
          className="select-none"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
