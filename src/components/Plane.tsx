import type { LatLon } from "../lib/geo";
import { useAirport } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { projectToSvg, inViewport } from "../lib/projection";
import { AIRPLANE_PATH } from "./icons";

// Phase colours reference the shared design tokens (no inline hex).
const PHASE_COLOR: Record<string, string> = {
  approach: "var(--color-status-arrival)", // arriving
  runway: "var(--color-status-runway)", // on/over the runway
  departure: "var(--color-status-departure)", // climbing out
};
const INACTIVE_COLOR = "var(--color-muted)";
const SELECT_COLOR = "var(--color-status-arrival)";
const LABEL_COLOR = "var(--color-on-surface)";

/**
 * A single aircraft, drawn as a small plane glyph pointing along its track.
 * Tappable to select (with a generous invisible hit area); the selected aircraft
 * gets a ring and always shows its label.
 */
export function Plane({
  item,
  pos,
  selected,
  onSelect,
}: {
  item: AircraftWithAssignment;
  /** Optional dead-reckoned position; falls back to the aircraft's last fix. */
  pos?: LatLon;
  selected?: boolean;
  onSelect?: (hex: string) => void;
}) {
  const { ac, assignment } = item;
  const { arp } = useAirport().config;
  const pt = projectToSvg(arp, pos ?? { lat: ac.lat, lon: ac.lon });
  if (!inViewport(pt, 20)) return null;

  const heading = ac.track ?? 0;
  const color = assignment ? PHASE_COLOR[assignment.phase] : INACTIVE_COLOR;
  const active = assignment !== null;
  const show = active || selected;
  const label = ac.flight ?? ac.hex.toUpperCase();

  return (
    <g
      transform={`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`}
      opacity={show ? 1 : 0.5}
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
      {/* Radar target: a sharp 1px square boundary (per design, not a circle). */}
      {selected && (
        <rect
          x={-8}
          y={-8}
          width={16}
          height={16}
          fill="none"
          stroke={SELECT_COLOR}
          strokeWidth={1.4}
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
          stroke="var(--color-surface-container-lowest)"
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
          fill={selected ? LABEL_COLOR : color}
          className="select-none"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
