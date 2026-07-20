import { useAirport } from "../hooks/useAirport";
import { usePois } from "../hooks/usePois";
import { projectToSvg, SVG_H, SVG_W } from "../lib/projection";

const PAD = 12;

/**
 * Renders user-defined regions of interest as emoji pins in the map's coordinate
 * space, so they pan and zoom with everything else. A pin outside the mapped area
 * (e.g. a phone location several km from the field) is clamped to the nearest
 * edge and dimmed, so it's still indicated rather than silently missing.
 * Non-interactive (pointer events pass through to the map for drag/zoom).
 */
export function PoiLayer() {
  const { pois } = usePois();
  const { arp } = useAirport().config;
  return (
    <g style={{ pointerEvents: "none" }}>
      {pois.map((p) => {
        const raw = projectToSvg(arp, { lat: p.lat, lon: p.lon });
        const x = Math.max(PAD, Math.min(SVG_W - PAD, raw.x));
        const y = Math.max(PAD, Math.min(SVG_H - PAD, raw.y));
        const offMap = x !== raw.x || y !== raw.y;
        return (
          <g
            key={p.id}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            opacity={offMap ? 0.5 : 1}
          >
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={16}
              style={{ userSelect: "none" }}
            >
              {p.emoji}
            </text>
            {p.label && !offMap && (
              <text
                y={15}
                textAnchor="middle"
                fontSize={7.5}
                fill="var(--color-on-surface)"
                stroke="var(--color-surface-container-lowest)"
                strokeWidth={0.5}
                paintOrder="stroke"
                style={{ userSelect: "none", fontFamily: "var(--font-sans)" }}
              >
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
