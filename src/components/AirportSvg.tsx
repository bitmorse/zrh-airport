import { memo, useEffect, useRef } from "react";
import { useAirport } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useViewport } from "../hooks/useViewport";
import type { LatLon } from "../lib/geo";
import { projectToSvg, SVG_W, SVG_H } from "../lib/projection";
import { PlaneLayer } from "./PlaneLayer";
import { PoiLayer } from "./PoiLayer";
import { RunwayHeat } from "./RunwayHeat";
import { TrailLayer } from "./TrailLayer";
import { UserLayer } from "./UserLayer";

function AirportSvgImpl({
  aircraft,
  counts,
  lastUpdated,
  selectedHex,
  trail,
  userPosition,
  heading,
  fenceRadiusM,
  recording,
  locateNonce,
  onLocate,
  onSelect,
}: {
  aircraft: AircraftWithAssignment[];
  counts: Record<string, number>;
  lastUpdated: number | null;
  selectedHex?: string | null;
  trail?: LatLon[];
  userPosition?: LatLon | null;
  heading?: number | null;
  fenceRadiusM?: number;
  recording?: boolean;
  locateNonce?: number;
  onLocate?: () => void;
  onSelect?: (hex: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const airport = useAirport();
  const { viewBox, zoom, zoomIn, zoomOut, reset, focusOn, centerOn, isDragging, bind } =
    useViewport(svgRef);

  // Recenter on the user each time the locate button is tapped — once a fix exists.
  // The nonce (bumped per tap) also handles the case where GPS wasn't ready at tap.
  const centeredNonce = useRef<number | null>(null);
  useEffect(() => {
    if (locateNonce == null || locateNonce === centeredNonce.current || !userPosition) return;
    centeredNonce.current = locateNonce;
    centerOn(projectToSvg(airport.config.arp, userPosition));
  }, [locateNonce, userPosition, airport, centerOn]);

  // When a flight is selected (e.g. tapped in a board), reveal it on the map if it
  // isn't already in view — once per selection, framed with the field.
  const focusedHex = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedHex) {
      focusedHex.current = null;
      return;
    }
    if (focusedHex.current === selectedHex) return;
    const sel = aircraft.find((a) => a.ac.hex === selectedHex);
    if (!sel) return; // not in this poll yet — retry on the next
    focusedHex.current = selectedHex;
    const target = projectToSvg(airport.config.arp, { lat: sel.ac.lat, lon: sel.ac.lon });
    focusOn(target, { x: SVG_W / 2, y: SVG_H / 2 });
  }, [selectedHex, aircraft, airport, focusOn]);

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full w-full"
        style={{ touchAction: "none", cursor: isDragging ? "grabbing" : "grab" }}
        role="img"
        aria-label={`Schematic map of ${airport.config.name} runways with live traffic`}
        {...bind}
      >
      <defs>
        <radialGradient id="field" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#0b1120" />
        </radialGradient>
      </defs>

      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="url(#field)" />

      {/* Range rings around the airport reference point (centre of the frame). */}
      {[0.33, 0.66, 1].map((r) => (
        <circle
          key={r}
          cx={SVG_W / 2}
          cy={SVG_H / 2}
          r={(SVG_H / 2) * r}
          fill="none"
          stroke="#1e293b"
          strokeWidth={1}
          strokeDasharray="4 6"
        />
      ))}

      {/* North arrow. */}
      <g transform={`translate(${SVG_W - 34} 34)`} opacity={0.8}>
        <line x1={0} y1={16} x2={0} y2={-14} stroke="#64748b" strokeWidth={1.5} />
        <path d="M0,-18 L4,-10 L-4,-10 Z" fill="#94a3b8" />
        <text x={0} y={30} textAnchor="middle" fontSize={11} fill="#94a3b8">
          N
        </text>
      </g>

      {airport.stripPairs.map((pair) => (
        <RunwayHeat key={pair[0].strip} ends={pair} counts={counts} />
      ))}

      <PoiLayer />

      {trail && (
        <TrailLayer
          points={trail}
          ac={aircraft.find((a) => a.ac.hex === selectedHex)?.ac}
          lastUpdated={lastUpdated}
        />
      )}

      <PlaneLayer
        aircraft={aircraft}
        lastUpdated={lastUpdated}
        selectedHex={selectedHex}
        onSelect={onSelect}
      />

      {userPosition && (
        <UserLayer
          userPos={userPosition}
          heading={heading ?? null}
          radiusM={fenceRadiusM ?? 0}
          recording={!!recording}
        />
      )}
      </svg>

      <div className="absolute left-2 top-2 flex flex-col gap-1">
        <ZoomButton label="Zoom in" onClick={zoomIn} disabled={zoom >= 8}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={zoomOut} disabled={zoom <= 1}>
          −
        </ZoomButton>
        <ZoomButton label="Reset view" onClick={reset} disabled={zoom === 1}>
          ⟳
        </ZoomButton>
        {onLocate && (
          <ZoomButton
            label="Show my location"
            onClick={onLocate}
            active={!!userPosition}
          >
            ⌖
          </ZoomButton>
        )}
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md border text-lg leading-none disabled:opacity-30 ${
        active
          ? "border-sky-500 bg-sky-600/30 text-sky-200 hover:bg-sky-600/40"
          : "border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

// Memoised: the 1 s clock in App re-renders the status text every second, but the
// map only needs to update when traffic data (a new poll) actually changes.
export const AirportSvg = memo(AirportSvgImpl);
