import { useEffect, useState } from "react";
import type { Aircraft } from "../data/adsb";
import { type Airport } from "../data/flightInfo";
import type { RunwayAssignment } from "../domain/assignRunway";
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

const PHASE_LABEL: Record<string, string> = {
  approach: "on approach",
  runway: "on the runway",
  departure: "departing",
};

/**
 * The phase / altitude / speed line, dead-reckoned and refreshed at ~10 Hz so it
 * reads live. Shows both heights above field, labelled to disambiguate: GNSS
 * (geometric — what the GPWS uses) and baro (pressure altitude, offset on
 * non-standard-pressure days). Speed stays stepwise — ADS-B carries no acceleration.
 */
function MotionReadout({
  ac,
  assignment,
  lastUpdated,
  fieldElevationFt,
  geoidFt,
  units,
}: {
  ac: Aircraft;
  assignment: RunwayAssignment | null;
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

  return (
    <p className="text-[11px] text-slate-500">
      {assignment ? `${PHASE_LABEL[assignment.phase]} · RWY ${assignment.end}` : "in range"}
      {" · "}
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
  lastUpdated,
  onClear,
}: {
  item: AircraftWithAssignment | null;
  lastUpdated: number | null;
  onClear: () => void;
}) {
  const callsign = item?.ac.flight ?? null;
  const route = useFlightRoute(callsign);
  const [{ units }] = useSettings();
  const { iata, icao, fieldElevationFt, geoidFt } = useAirport().config;
  const [gpws, setGpws] = useState(false);
  // Reset the toggle whenever the selection changes.
  useEffect(() => setGpws(false), [item?.ac.hex]);
  useGpws(item, gpws);

  if (!item) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold text-slate-200">Flight lookup</h2>
        <p className="mt-1 text-xs text-slate-500">
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
          <h2 className="font-mono text-base font-semibold text-slate-100">
            {title}
          </h2>
          <MotionReadout
            ac={ac}
            assignment={assignment}
            lastUpdated={lastUpdated}
            fieldElevationFt={fieldElevationFt}
            geoidFt={geoidFt ?? 0}
            units={units}
          />
          {(ac.type || ac.typeDesc || ac.registration) && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              <span className="text-slate-300">
                {ac.typeDesc ?? ac.type ?? "Unknown type"}
              </span>
              {ac.type && ac.typeDesc ? (
                <span className="text-slate-500"> · {ac.type}</span>
              ) : null}
              {ac.registration ? (
                <span className="font-mono text-slate-500"> · {ac.registration}</span>
              ) : null}
            </p>
          )}
          <label
            className="mt-1.5 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-slate-400"
            title="Speak GPWS altitude callouts as it descends (simulation from GNSS altitude)"
          >
            <input
              type="checkbox"
              checked={gpws}
              onChange={(e) => setGpws(e.target.checked)}
              className="accent-sky-500"
            />
            play GPWS
            {gpws && <span className="text-amber-300">◉ live</span>}
          </label>
        </div>
        <button
          onClick={onClear}
          aria-label="Clear selection"
          className="shrink-0 rounded px-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          ✕
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
              <div className="text-slate-300">
                {r.airlineName ?? "Unknown airline"}
                {r.flightIata && (
                  <span className="ml-1 text-slate-500">· {r.flightIata}</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Endpoint airport={r.origin} />
              <span className="text-slate-500">→</span>
              <Endpoint airport={r.destination} />
            </div>
            {conflict && (
              <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-300/90">
                {conflict === "departing-inbound-route"
                  ? `Now departing ${iata} — this is the callsign's inbound leg. It's flying out (the callsign is reused for the turnaround), so this isn't the live destination.`
                  : `Now arriving ${iata} — this is the callsign's outbound leg; it may be reused for the turnaround.`}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-[10px] text-slate-600">
          route data · adsbdb.com — may be approximate
        </p>
      </div>
    </div>
  );
}

function Endpoint({ airport }: { airport: Airport | null }) {
  if (!airport) return <span className="text-slate-500">—</span>;
  return (
    <div className="min-w-0">
      <div className="font-mono text-sm font-semibold text-sky-300">
        {airport.iata ?? airport.icao ?? "??"}
      </div>
      <div className="truncate text-[11px] text-slate-400">
        {airport.municipality ?? airport.name ?? ""}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>;
}
