import { usePois } from "../hooks/usePois";
import { inViewport, projectToSvg } from "../lib/projection";

/**
 * Renders user-defined regions of interest as emoji pins in the map's coordinate
 * space, so they pan and zoom with everything else. Non-interactive (pointer
 * events pass through to the map for drag/zoom).
 */
export function PoiLayer() {
  const { pois } = usePois();
  return (
    <g style={{ pointerEvents: "none" }}>
      {pois.map((p) => {
        const pt = projectToSvg({ lat: p.lat, lon: p.lon });
        if (!inViewport(pt, 40)) return null;
        return (
          <g key={p.id} transform={`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`}>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={16}
              style={{ userSelect: "none" }}
            >
              {p.emoji}
            </text>
            {p.label && (
              <text
                y={15}
                textAnchor="middle"
                fontSize={7.5}
                fill="#cbd5e1"
                stroke="#0b1120"
                strokeWidth={0.5}
                paintOrder="stroke"
                style={{ userSelect: "none", fontFamily: "ui-sans-serif, system-ui" }}
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
