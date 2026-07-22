import { memo, useEffect, useRef } from "react";
import type { CurrentWind } from "../data/airportWeather";
import type { FlightState } from "../domain/flightState";
import { useAirport } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useViewport } from "../hooks/useViewport";
import type { LatLon } from "../lib/geo";
import { projectToSvg, SVG_W, SVG_H } from "../lib/projection";
import { PlaneLayer } from "./PlaneLayer";
import { WindChip } from "./WindChip";
import { PoiLayer } from "./PoiLayer";
import { RunwayHeat } from "./RunwayHeat";
import { TrailLayer } from "./TrailLayer";
import { UserLayer } from "./UserLayer";
import { MyLocationIcon, RefreshIcon, ZoomInIcon, ZoomOutIcon } from "./icons";

function AirportSvgImpl({
  aircraft,
  byHex,
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
  onInteract,
  onSelect,
  wind,
}: {
  aircraft: AircraftWithAssignment[];
  /** Canonical joined state — used to resolve the selected aircraft (one index lookup). */
  byHex?: ReadonlyMap<string, FlightState>;
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
  /** Fired when the user directly manipulates the map (pan/zoom), to mark activity. */
  onInteract?: () => void;
  onSelect?: (hex: string) => void;
  /** Current airport wind for the optional overlay (chip + crosswind arrows). */
  wind?: CurrentWind | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const airport = useAirport();
  const { viewBox, zoom, zoomIn, zoomOut, reset, focusOn, centerOn, isTargetVisible, isDragging, bind } =
    useViewport(svgRef, onInteract);

  // Recenter on the user each time the locate button is tapped — once a fix exists.
  // The nonce (bumped per tap) also handles the case where GPS wasn't ready at tap.
  const centeredNonce = useRef<number | null>(null);
  useEffect(() => {
    if (locateNonce == null || locateNonce === centeredNonce.current || !userPosition) return;
    centeredNonce.current = locateNonce;
    centerOn(projectToSvg(airport.config.arp, userPosition));
  }, [locateNonce, userPosition, airport, centerOn]);

  // When a flight is selected (tapped on the map or in a board), reveal it once —
  // adaptively zooming in or out to frame it with the field. Afterwards leave the view
  // put; only snap back if the plane drifts off-screen (no continuous follow).
  const focusedHex = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedHex) {
      focusedHex.current = null;
      return;
    }
    const sel = byHex?.get(selectedHex);
    if (!sel) return; // not in this poll yet — retry on the next
    const target = projectToSvg(airport.config.arp, { lat: sel.ac.lat, lon: sel.ac.lon });
    const fieldCenter = { x: SVG_W / 2, y: SVG_H / 2 };
    if (focusedHex.current !== selectedHex) {
      focusedHex.current = selectedHex; // new selection → reveal
      focusOn(target, fieldCenter);
    } else if (!isTargetVisible(target)) {
      focusOn(target, fieldCenter); // drifted off-screen → snap back once
    }
  }, [selectedHex, byHex, airport, focusOn, isTargetVisible]);

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full select-none"
        style={{ touchAction: "none", cursor: isDragging ? "grabbing" : "grab" }}
        role="img"
        aria-label={`Schematic map of ${airport.config.name} runways with live traffic`}
        {...bind}
      >
      {/* Radar scope — the cleanest white surface (light radar per design). */}
      <rect
        x={0}
        y={0}
        width={SVG_W}
        height={SVG_H}
        fill="var(--color-surface-container-lowest)"
      />

      {/* Range rings around the airport reference point (centre of the frame). */}
      {[0.33, 0.66, 1].map((r) => (
        <circle
          key={r}
          cx={SVG_W / 2}
          cy={SVG_H / 2}
          r={(SVG_H / 2) * r}
          fill="none"
          stroke="var(--color-outline-variant)"
          strokeWidth={1}
          strokeDasharray="4 6"
        />
      ))}

      {/* North arrow. */}
      <g transform={`translate(${SVG_W - 34} 34)`}>
        <line
          x1={0}
          y1={16}
          x2={0}
          y2={-14}
          stroke="var(--color-on-surface-variant)"
          strokeWidth={1.5}
        />
        <path d="M0,-18 L4,-10 L-4,-10 Z" fill="var(--color-on-surface-variant)" />
        <text
          x={0}
          y={30}
          textAnchor="middle"
          fontSize={11}
          fill="var(--color-on-surface-variant)"
        >
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
          ac={selectedHex ? byHex?.get(selectedHex)?.ac : undefined}
          lastUpdated={lastUpdated}
        />
      )}

      <PlaneLayer
        aircraft={aircraft}
        lastUpdated={lastUpdated}
        selectedHex={selectedHex}
        onSelect={onSelect}
        wind={wind}
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

      {wind && <WindChip wind={wind} />}

      <div className="absolute left-2 top-2 flex flex-col gap-1">
        <ZoomButton label="Zoom in" onClick={zoomIn} disabled={zoom >= 8}>
          <ZoomInIcon size={18} />
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={zoomOut} disabled={zoom <= 1}>
          <ZoomOutIcon size={18} />
        </ZoomButton>
        <ZoomButton label="Reset view" onClick={reset} disabled={zoom === 1}>
          <RefreshIcon size={18} />
        </ZoomButton>
        {onLocate && (
          <ZoomButton
            label="Show my location"
            onClick={onLocate}
            active={!!userPosition}
          >
            <MyLocationIcon size={18} />
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
      className={`flex h-8 w-8 items-center justify-center border leading-none disabled:opacity-30 ${
        active
          ? "border-primary bg-primary text-on-primary hover:bg-primary-container"
          : "border-border bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container"
      }`}
    >
      {children}
    </button>
  );
}

// Memoised: the 1 s clock in App re-renders the status text every second, but the
// map only needs to update when traffic data (a new poll) actually changes.
export const AirportSvg = memo(AirportSvgImpl);
