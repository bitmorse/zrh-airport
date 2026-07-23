import type { Aircraft } from "../data/adsb";
import { type Airport } from "../data/flightInfo";
import type { FlightEndpoint, FlightLookup } from "../data/flightLookup";
import type { FlightStatus } from "../domain/flightStatus";
import { fieldRelation, routeConflict } from "../domain/routeCheck";
import { useAirport } from "../hooks/useAirport";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { useGpws } from "../hooks/useGpws";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useNow } from "../hooks/useNow";
import { useSmoothClock } from "../hooks/useSmoothClock";
import { useSettings } from "../hooks/useSettings";
import { etaToDestination, humanDuration, localHhmm } from "../lib/flightEta";
import type { Units } from "../lib/format";
import { formatAltitude, formatSpeed } from "../lib/format";
import { elapsedSec, reckonAltFt } from "../lib/reckon";
import { CloseIcon } from "./icons";

/**
 * Live altitude + speed for the selected aircraft, dead-reckoned and refreshed at ~10 Hz.
 * Shows both heights above field: GNSS (geometric — what the GPWS uses) and baro. The
 * phase is shown as a pill in the card header, so it isn't repeated here.
 */
function MotionReadout({
  ac,
  lastUpdated,
  fieldElevationFt,
  geoidFt,
  units,
}: {
  ac: Aircraft;
  lastUpdated: number | null;
  fieldElevationFt: number;
  geoidFt: number;
  units: Units;
}) {
  const now = useSmoothClock();
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
    <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
      {altText}
      {" · "}
      {ac.gs != null ? formatSpeed(ac.gs, units) : "—"}
    </p>
  );
}

/** Colour a phase/status pill by the kind of thing the aircraft is doing. Handles both
 *  our live phase words and AeroAPI status strings ("Scheduled", "En Route", …). */
function pillClass(label: string): string {
  const l = label.toLowerCase();
  if (/cancel|divert/.test(l)) return "bg-status-alert text-on-primary";
  if (/approach|landing|just landed|arrived/.test(l)) return "bg-status-arrival text-on-primary";
  if (/climb|depart|takeoff/.test(l)) return "bg-status-departure text-on-primary";
  if (/runway|waiting|cleared|en route|airborne/.test(l)) return "bg-status-cleared text-on-primary";
  return "bg-surface-container text-on-surface-variant"; // scheduled / taxiing / on the ground / unknown
}

/** Local HH:MM from an ISO8601 UTC string, or null. */
function fmtTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? localHhmm(ms) : null;
}

/** Whole minutes of delay, or null when under a minute / unknown. */
function delayMin(sec: number | null | undefined): number | null {
  return sec != null && sec >= 60 ? Math.round(sec / 60) : null;
}

/**
 * The selected aircraft, as a flight-status card: a phase pill, the flight number +
 * aircraft type, a timing headline (ETA to destination, from live groundspeed), the
 * airline + registration, and an origin→dest strip. Route data is from adsbdb (cached).
 */
export function FlightDetails({
  item,
  status,
  lastUpdated,
  estimatedNote,
  lookup,
  cockpitActive,
  cockpitAudio,
  onClear,
}: {
  item: AircraftWithAssignment | null;
  /** Meaningful phase phrase for the selected aircraft (e.g. "just landed"). */
  status: FlightStatus | null;
  lastUpdated: number | null;
  /** Set when the shown position is a guess (searched flight, not a live fix). */
  estimatedNote?: string | null;
  /** On-request AeroAPI enrichment (gate / status / scheduled times) for a searched flight. */
  lookup?: FlightLookup | null;
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
  const now = useNow(1000);

  if (!item) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Flight lookup</h2>
        <p className="mt-1 text-xs text-muted">
          Tap a plane on the map, or any movement in the boards, to see its type, route and
          live altitude — the map recentres on it and draws its track.
        </p>
      </div>
    );
  }

  const { ac, assignment } = item;
  const r = route.data;
  // Prefer live/adsbdb data; fall back to the AeroAPI lookup so a searched flight that
  // isn't broadcasting still shows its number, type, airline and registration.
  const flightNo = r?.flightIata ?? lookup?.identIata ?? ac.flight?.trim() ?? ac.hex.toUpperCase();
  const acType = ac.type ?? lookup?.aircraftType ?? null;
  const airlineName = r?.airlineName ?? lookup?.operator ?? null;
  const registration = ac.registration ?? lookup?.registration ?? null;
  const pillLabel = lookup?.status ?? status?.label ?? (ac.onGround ? "On ground" : "Airborne");
  const phaseLabel = status?.label
    ? status.rwy
      ? `${status.label} · RWY ${status.rwy}`
      : status.label
    : ac.onGround
      ? "On the ground"
      : "Airborne";

  const eta = etaToDestination(ac, r?.destination, now);
  const destTime = eta ? localHhmm(eta.arriveAtMs) : null;
  const headline =
    eta && r?.destination
      ? `Arrives ${r.destination.iata ?? r.destination.icao ?? ""} in ${humanDuration(eta.etaSec)}`
      : scheduleHeadline(lookup) ?? phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1);

  const conflict = routeConflict(r, iata, icao, fieldRelation(ac, assignment));

  return (
    <div className="text-sm">
      {/* Header: phase pill · flight number + type · close. */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${pillClass(pillLabel)}`}
        >
          {pillLabel}
        </span>
        <div className="flex items-start gap-1">
          <div className="text-right">
            <div className="font-mono text-base font-semibold text-on-surface">{flightNo}</div>
            {acType && <div className="text-[11px] text-muted">{acType}</div>}
          </div>
          <button
            onClick={onClear}
            aria-label="Clear selection"
            className="shrink-0 px-1 text-muted hover:bg-surface-container hover:text-on-surface"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Headline: the timing. */}
      <h2 className="mt-2 text-lg font-semibold leading-tight text-on-surface">{headline}</h2>
      {estimatedNote && (
        <p className="mt-1 w-fit border border-dashed border-border px-1.5 py-0.5 text-[11px] text-on-surface-variant">
          {estimatedNote}
        </p>
      )}
      <MotionReadout
        ac={ac}
        lastUpdated={lastUpdated}
        fieldElevationFt={fieldElevationFt}
        geoidFt={geoidFt ?? 0}
        units={units}
      />

      {/* Airline · aircraft · registration. */}
      <p className="mt-1 text-xs">
        <span className="text-on-surface">{airlineName ?? "Airline unknown"}</span>
        {(ac.typeDesc || registration) && (
          <span className="text-muted">
            {" · "}
            {[ac.typeDesc ?? acType, registration].filter(Boolean).join(" · ")}
          </span>
        )}
      </p>

      {callout && (
        <p
          className="mt-2 w-fit bg-status-alert px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-on-primary"
          title="GPWS callout just triggered (estimated height above field — the data layer, independent of the audio)"
        >
          GPWS: {callout}!
        </p>
      )}

      {/* Schedule (gate/terminal + scheduled vs estimated times) when the AeroAPI lookup
          is available, else the plain adsbdb origin→dest strip with the live ETA. */}
      {lookup ? (
        <Schedule lookup={lookup} />
      ) : (
        <div className="mt-3 border-t border-border pt-2">
          {!callsign ? (
            <Muted>No callsign broadcast — can’t look up a route.</Muted>
          ) : route.isLoading ? (
            <Muted>Looking up route…</Muted>
          ) : route.isError ? (
            <Muted>Route lookup unavailable right now.</Muted>
          ) : !r ? (
            <Muted>No route on file for this callsign.</Muted>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Endpoint airport={r.origin} />
                <span aria-hidden className="px-2 text-on-surface-variant">✈</span>
                <Endpoint airport={r.destination} time={destTime} align="right" />
              </div>
              {conflict && (
                <p className="mt-2 border-l-2 border-status-departure bg-surface-container-high px-2 py-1 text-[11px] leading-relaxed text-on-surface">
                  {conflict === "departing-inbound-route"
                    ? `Now departing ${iata} — this is the callsign's inbound leg. It's flying out (the callsign is reused for the turnaround), so this isn't the live destination.`
                    : `Now arriving ${iata} — this is the callsign's outbound leg; it may be reused for the turnaround.`}
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-[10px] text-muted">route + ETA are live estimates · adsbdb.com</p>
        </div>
      )}
    </div>
  );
}

function Endpoint({
  airport,
  time,
  align,
}: {
  airport: Airport | null;
  time?: string | null;
  align?: "right";
}) {
  if (!airport) return <span className="text-muted">—</span>;
  const right = align === "right";
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <div className="font-mono">
        {right && time && <span className="mr-1 text-sm text-status-cleared">{time}</span>}
        <span className="text-base font-semibold text-status-arrival">
          {airport.iata ?? airport.icao ?? "??"}
        </span>
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

/** A concise timing headline from the AeroAPI schedule (used when there's no live ETA). */
function scheduleHeadline(lookup: FlightLookup | null | undefined): string | null {
  if (!lookup) return null;
  const code = (e: FlightEndpoint | null) => e?.iata ?? e?.icao ?? "";
  const arr = lookup.actualIn ?? lookup.estimatedIn ?? lookup.scheduledIn;
  const dep = lookup.actualOut ?? lookup.estimatedOut ?? lookup.scheduledOut;
  if ((lookup.actualIn || /arrived/i.test(lookup.status ?? "")) && fmtTime(arr)) {
    return `Arrived ${code(lookup.destination)} ${fmtTime(arr)}`;
  }
  if (fmtTime(dep) && (lookup.progressPercent ?? 0) < 100) {
    const dm = delayMin(lookup.departureDelay);
    return `Departs ${code(lookup.origin)} ${fmtTime(dep)}${dm ? ` · ${dm} min late` : ""}`;
  }
  return null;
}

/** The AeroAPI schedule: a departure and an arrival row, each with gate/terminal and the
 *  scheduled time struck through when a newer estimate/actual differs, plus any delay. */
function Schedule({ lookup }: { lookup: FlightLookup }) {
  return (
    <div className="mt-3 border-t border-border pt-2 text-xs">
      <SchedRow
        label="Departs"
        ep={lookup.origin}
        gate={lookup.gateOrigin}
        terminal={lookup.terminalOrigin}
        scheduled={lookup.scheduledOut}
        estimated={lookup.actualOut ?? lookup.estimatedOut}
        delaySec={lookup.departureDelay}
      />
      <SchedRow
        label="Arrives"
        ep={lookup.destination}
        gate={lookup.gateDestination}
        terminal={lookup.terminalDestination}
        scheduled={lookup.scheduledIn}
        estimated={lookup.actualIn ?? lookup.estimatedIn}
        delaySec={lookup.arrivalDelay}
      />
      <p className="mt-2 text-[10px] text-muted">gate + schedule · FlightAware (may change)</p>
    </div>
  );
}

function SchedRow({
  label,
  ep,
  gate,
  terminal,
  scheduled,
  estimated,
  delaySec,
}: {
  label: string;
  ep: FlightEndpoint | null;
  gate: string | null;
  terminal: string | null;
  scheduled: string | null;
  estimated: string | null;
  delaySec: number | null;
}) {
  const s = fmtTime(scheduled);
  const e = fmtTime(estimated);
  const changed = e != null && e !== s;
  const dm = delayMin(delaySec);
  const place = [ep?.iata ?? ep?.icao ?? "—", gate && `gate ${gate}`, terminal && `T${terminal}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 font-mono">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-on-surface-variant">{label}</span>
      <span className="min-w-0 flex-1 truncate text-on-surface">{place}</span>
      <span className="shrink-0">
        {s && <span className={changed ? "text-muted line-through" : "text-on-surface"}>{s}</span>}
        {changed && <span className="ml-1 text-status-cleared">{e}</span>}
        {!s && !e && <span className="text-muted">—</span>}
        {dm ? <span className="ml-1 text-status-alert">+{dm}m</span> : null}
      </span>
    </div>
  );
}
