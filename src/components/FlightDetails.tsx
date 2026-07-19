import { type Airport } from "../data/flightInfo";
import { altAboveFieldFt } from "../domain/assignRunway";
import { useAirport } from "../hooks/useAirport";
import { useFlightRoute } from "../hooks/useFlightRoute";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useSettings } from "../hooks/useSettings";
import { formatAltitude, formatSpeed } from "../lib/format";

const PHASE_LABEL: Record<string, string> = {
  approach: "on approach",
  runway: "on the runway",
  departure: "departing",
};

/**
 * Details for the selected aircraft: airline, flight number and route, looked up
 * from the callsign via adsbdb (cached by TanStack Query). Falls back gracefully
 * when a callsign isn't in the database.
 */
export function FlightDetails({
  item,
  onClear,
}: {
  item: AircraftWithAssignment | null;
  onClear: () => void;
}) {
  const callsign = item?.ac.flight ?? null;
  const route = useFlightRoute(callsign);
  const [{ units }] = useSettings();
  const { fieldElevationFt } = useAirport().config;

  if (!item) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold text-slate-200">Flight lookup</h2>
        <p className="mt-1 text-xs text-slate-500">
          Tap a plane on the map (or a runway’s inbound below) to see its airline,
          flight number and route.
        </p>
      </div>
    );
  }

  const { ac, assignment } = item;
  const title = ac.flight ?? ac.hex.toUpperCase();
  const r = route.data;

  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-mono text-base font-semibold text-slate-100">
            {title}
          </h2>
          <p className="text-[11px] text-slate-500">
            {assignment
              ? `${PHASE_LABEL[assignment.phase]} · RWY ${assignment.end}`
              : "in range"}
            {" · "}
            {formatAltitude(altAboveFieldFt(ac, fieldElevationFt), units)} ·{" "}
            {ac.gs != null ? formatSpeed(ac.gs, units) : "—"}
          </p>
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
