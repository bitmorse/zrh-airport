import type { Aircraft } from "../data/adsb";
import { type Airport } from "../data/flightInfo";
import type { FlightStatus } from "../domain/flightStatus";
import { fieldRelation, routeConflict } from "../domain/routeCheck";
import { useAirport } from "../hooks/useAirport";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { useGpws } from "../hooks/useGpws";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useRafNow } from "../hooks/useNow";
import { useSettings } from "../hooks/useSettings";
import type { Units } from "../lib/format";
import { formatAltitude, formatSpeed } from "../lib/format";
import { elapsedSec, reckonAltFt } from "../lib/reckon";
import { CloseIcon } from "./icons";

/**
 * The phase / altitude / speed line, dead-reckoned and refreshed at ~10 Hz so it
 * reads live. Shows both heights above field, labelled to disambiguate: GNSS
 * (geometric — what the GPWS uses) and baro (pressure altitude, offset on
 * non-standard-pressure days). Speed stays stepwise — ADS-B carries no acceleration.
 */
function MotionReadout({
  ac,
  status,
  lastUpdated,
  fieldElevationFt,
  geoidFt,
  units,
}: {
  ac: Aircraft;
  status: FlightStatus | null;
  lastUpdated: number | null;
  fieldElevationFt: number;
  geoidFt: number;
  units: Units;
}) {
  const now = useRafNow(100);
  const elapsed = elapsedSec(lastUpdated, now);
  const reckon = (base: number | null, extra = 0) =>
    base == null ? null : Math.max(0, reckonAltFt(base, ac.verticalRateFpm, elapsed) - extra);

  let altText: string;
  if (ac.onGround) {
    altText = formatAltitude(0, units);
  } else {
    const gnss = reckon(ac.altGeomFt, fieldElevationFt + geoidFt);
    const baro = reckon(ac.altFt, fieldElevationFt);
    const parts: string[] = [];
    if (gnss != null) parts.push(`${formatAltitude(gnss, units)} GNSS`);
    if (baro != null) parts.push(`${formatAltitude(baro, units)} baro`);
    altText = parts.length ? parts.join(" · ") : "—";
  }

  const phase = status?.label
    ? status.rwy
      ? `${status.label} · RWY ${status.rwy}`
      : status.label
    : null;

  return (
    <p className="text-[11px] text-muted">
      {phase && `${phase} · `}
      {altText}
      {" · "}
      {ac.gs != null ? formatSpeed(ac.gs, units) : "—"}
    </p>
  );
}

/**
 * Details for the selected aircraft: airline, flight number and route, looked up
 * from the callsign via adsbdb (cached by TanStack Query). Falls back gracefully
 * when a callsign isn't in the database.
 */
export function FlightDetails({
  item,
  status,
  lastUpdated,
  cockpitActive,
  cockpitAudio,
  onClear,
}: {
  item: AircraftWithAssignment | null;
  /** Meaningful phase phrase for the selected aircraft (e.g. "just landed"). */
  status: FlightStatus | null;
  lastUpdated: number | null;
  /** Cockpit sim is enabled — run the GPWS state machine + show the callout readout. */
  cockpitActive: boolean;
  /** GPWS audio may play (sim on, not muted, not recording). */
  cockpitAudio: boolean;
  onClear: () => void;
}) {
  const callsign = item?.ac.flight ?? null;
  const route = useFlightRoute(callsign);
  const [{ units }] = useSettings();
  const { iata, icao, fieldElevationFt, geoidFt } = useAirport().config;
  const { callout } = useGpws(item, { active: cockpitActive, audible: cockpitAudio });

  if (!item) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Flight lookup</h2>
        <p className="mt-1 text-xs text-muted">
          Tap a plane on the map, or any movement in the boards, to see its type,
          route and live altitude — the map recentres on it and draws its track.
        </p>
      </div>
    );
  }

  const { ac, assignment } = item;
  const title = ac.flight ?? ac.hex.toUpperCase();
  const r = route.data;
  // Cross-check the scheduled route against the live direction: a plane departing
  // our field while the route ends here is flying the callsign's inbound leg.
  const conflict = routeConflict(r, iata, icao, fieldRelation(ac, assignment));

  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-mono text-base font-semibold text-on-surface">
            {title}
          </h2>
          <MotionReadout
            ac={ac}
            status={status}
            lastUpdated={lastUpdated}
            fieldElevationFt={fieldElevationFt}
            geoidFt={geoidFt ?? 0}
            units={units}
          />
          {(ac.type || ac.typeDesc || ac.registration) && (
            <p className="mt-0.5 text-[11px] text-on-surface-variant">
              <span className="text-on-surface">
                {ac.typeDesc ?? ac.type ?? "Unknown type"}
              </span>
              {ac.type && ac.typeDesc ? (
                <span className="text-muted"> · {ac.type}</span>
              ) : null}
              {ac.registration ? (
                <span className="font-mono text-muted"> · {ac.registration}</span>
              ) : null}
            </p>
          )}
          {callout && (
            <p
              className="mt-1.5 w-fit bg-status-alert px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-on-primary"
              title="GPWS callout just triggered (from the estimated height above field — the data layer, independent of the audio)"
            >
              GPWS: {callout}!
            </p>
          )}
        </div>
        <button
          onClick={onClear}
          aria-label="Clear selection"
          className="shrink-0 px-1.5 text-muted hover:bg-surface-container hover:text-on-surface"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="mt-3">
        {!callsign ? (
          <Muted>No callsign broadcast — can’t look up a route.</Muted>
        ) : route.isLoading ? (
          <Muted>Looking up route…</Muted>
        ) : route.isError ? (
          <Muted>Route lookup unavailable right now.</Muted>
        ) : !r ? (
          <Muted>No route on file for this callsign.</Muted>
        ) : (
          <div className="flex flex-col gap-2">
            {(r.airlineName || r.flightIata) && (
              <div className="text-on-surface">
                {r.airlineName ?? "Unknown airline"}
                {r.flightIata && (
                  <span className="ml-1 text-muted">· {r.flightIata}</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Endpoint airport={r.origin} />
              <span className="text-muted">→</span>
              <Endpoint airport={r.destination} />
            </div>
            {conflict && (
              <p className="border-l-2 border-status-departure bg-surface-container-high px-2 py-1 text-[11px] leading-relaxed text-on-surface">
                {conflict === "departing-inbound-route"
                  ? `Now departing ${iata} — this is the callsign's inbound leg. It's flying out (the callsign is reused for the turnaround), so this isn't the live destination.`
                  : `Now arriving ${iata} — this is the callsign's outbound leg; it may be reused for the turnaround.`}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-[10px] text-muted">
          route data · adsbdb.com — may be approximate
        </p>
      </div>
    </div>
  );
}

function Endpoint({ airport }: { airport: Airport | null }) {
  if (!airport) return <span className="text-muted">—</span>;
  return (
    <div className="min-w-0">
      <div className="font-mono text-sm font-semibold text-status-arrival">
        {airport.iata ?? airport.icao ?? "??"}
      </div>
      <div className="truncate text-[11px] text-on-surface-variant">
        {airport.municipality ?? airport.name ?? ""}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}
