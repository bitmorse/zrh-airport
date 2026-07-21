import type { DepartureEvent } from "../domain/departures";
import { flightStatusLabel, type FlightStatus } from "../domain/flightStatus";
import type { Arrival } from "../domain/predictions";
import { buildQueues } from "../domain/queue";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { formatDuration, formatEta, routePairText } from "../lib/format";
import { elapsedSec } from "../lib/reckon";
import { LandingIcon, PlaneIcon, SquareIcon, TakeoffIcon } from "./icons";

/** Join short glanceable tokens with a middot, dropping empties. */
const secondaryOf = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ") || undefined;

const FLASH_SHOW_MS = 6000; // flash an approach gate for ~6 s after the crossing

/** One traffic row — identical layout for arrivals and departures. */
function TrafficRow({
  icon,
  end,
  callsign,
  secondary,
  time,
  timeClass = "text-on-surface",
  muted,
  highlight,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  end?: string;
  callsign?: string;
  secondary?: React.ReactNode;
  time?: string;
  timeClass?: string;
  muted?: string;
  highlight?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={onClick ? !!selected : undefined}
      title={end ? `Runway ${end}${callsign ? ` · ${callsign}` : ""}` : undefined}
      className={`relative flex w-full items-center gap-2 py-1.5 pr-3 pl-3.5 text-left hover:bg-surface-container disabled:cursor-default disabled:hover:bg-transparent ${
        selected ? "bg-surface-container" : highlight ? "bg-surface-container-highest" : ""
      }`}
    >
      {/* Selection cue — a solid primary rail. */}
      {selected && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
      )}
      <span aria-hidden className="flex items-center text-on-surface-variant">{icon}</span>
      {muted ? (
        <span className="flex-1 text-xs text-muted">{muted}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs">
          {/* Label the runway so the leading number isn't a mystery. */}
          {end && (
            <span className="font-semibold text-status-arrival">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                RWY
              </span>{" "}
              {end}
            </span>
          )}
          <span className="font-semibold text-on-surface">{end ? " " : ""}{callsign}</span>
          {secondary && <span className="text-muted"> · {secondary}</span>}
        </span>
      )}
      {time != null && (
        <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${timeClass}`}>
          {time}
        </span>
      )}
    </button>
  );
}

/** A single arrival row with its own route lookup + live countdown. */
function ArrivalRow({
  arrival,
  type,
  now,
  lastUpdated,
  stale,
  selected,
  onSelect,
}: {
  arrival: Arrival;
  type: string | null | undefined;
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  selected: boolean;
  onSelect?: (hex: string) => void;
}) {
  const route = useFlightRoute(arrival.callsign ?? null);
  const routePair = routePairText(route.data);
  const ageSec = elapsedSec(lastUpdated, now);
  const remaining = Math.max(0, arrival.etaSeconds - ageSec);
  const soon = remaining <= 60 && !stale;
  const flash =
    arrival.flash != null && now - arrival.flash.atMs <= FLASH_SHOW_MS
      ? arrival.flash.label
      : null;

  return (
    <TrafficRow
      icon={<LandingIcon size={16} />}
      end={arrival.end}
      callsign={arrival.callsign}
      secondary={
        flash ? (
          <span
            className="inline-flex animate-pulse items-center gap-1 font-semibold text-status-departure"
            title="Approach gate (AGL from GNSS altitude — an estimate)"
          >
            <SquareIcon size={9} /> {flash}
          </span>
        ) : (
          secondaryOf(type, routePair)
        )
      }
      time={stale ? "—" : formatEta(remaining)}
      timeClass={
        flash
          ? "text-status-departure"
          : stale
            ? "text-muted"
            : soon
              ? "text-status-cleared"
              : "text-on-surface"
      }
      highlight={!!flash}
      selected={selected}
      onClick={() => onSelect?.(arrival.hex)}
    />
  );
}

/**
 * Compact traffic strip shown above the map on mobile and in the desktop sidebar: the
 * full near-field sequence a tower/approach controller would read — every arrival due to
 * land within the queue horizon (soonest first) followed by every aircraft lining up to
 * depart (FIFO), all as one unified list of identical rows (runway · callsign · state,
 * with a right-aligned timer). The queue is derived by `buildQueues`; per-side overflow
 * past the cap collapses to a "+N more" line. Rows are tappable to select, and the
 * selected aircraft is always shown — even beyond the cap or when it's merely in range —
 * so the map selection and the board never disagree.
 */
export function TrafficBar({
  arrivals,
  departures,
  aircraft = [],
  now,
  lastUpdated,
  stale,
  selectedHex,
  selectedStatus,
  onSelect,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  aircraft?: AircraftWithAssignment[];
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  selectedHex?: string | null;
  /** Meaningful phase phrase for the selected aircraft, for its orphan board row. */
  selectedStatus?: FlightStatus | null;
  onSelect?: (hex: string) => void;
}) {
  const typeByHex = new Map(aircraft.map((w) => [w.ac.hex, w.ac.type]));
  const queues = buildQueues({ arrivals, departures, selectedHex });
  const orphan = queues.orphanHex
    ? aircraft.find((w) => w.ac.hex === queues.orphanHex)
    : undefined;

  return (
    <div className="w-full divide-y divide-border overflow-hidden border border-border bg-surface-container-low">
      {queues.arrivals.length > 0 ? (
        queues.arrivals.map((a) => (
          <ArrivalRow
            key={a.hex}
            arrival={a}
            type={typeByHex.get(a.hex)}
            now={now}
            lastUpdated={lastUpdated}
            stale={stale}
            selected={a.hex === selectedHex}
            onSelect={onSelect}
          />
        ))
      ) : (
        <TrafficRow icon={<LandingIcon size={16} />} muted="No inbound traffic" />
      )}

      {queues.arrivalsMore > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted">+{queues.arrivalsMore} more arriving</div>
      )}

      {queues.departures.map((d) => {
        const { secondary, time, timeClass } = depRow(d, now);
        return (
          <TrafficRow
            key={d.hex}
            icon={<TakeoffIcon size={16} />}
            end={d.end}
            callsign={d.callsign}
            secondary={secondaryOf(typeByHex.get(d.hex), secondary)}
            time={time}
            timeClass={timeClass}
            selected={d.hex === selectedHex}
            onClick={() => onSelect?.(d.hex)}
          />
        );
      })}

      {queues.departuresMore > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted">+{queues.departuresMore} more departing</div>
      )}

      {orphan && (
        <TrafficRow
          icon={<PlaneIcon size={16} />}
          end={orphan.assignment?.end ?? selectedStatus?.rwy}
          callsign={orphan.ac.flight ?? orphan.ac.hex.toUpperCase()}
          // Meaningful phase (e.g. "just landed" / "taxiing"); omitted for an unrelated
          // airborne aircraft rather than showing a vague "tracking · in range".
          secondary={selectedStatus?.label ?? undefined}
          selected
          onClick={() => onSelect?.(orphan.ac.hex)}
        />
      )}
    </div>
  );
}

/**
 * Right-aligned timer and its colour for a departure row. The state *word* comes from the
 * shared `flightStatusLabel` (one vocabulary across the board and detail panel); this
 * helper only owns the board's timer presentation. The departure branch of
 * `flightStatusLabel` reads `phase` alone, so a minimal `ac` is fine here.
 */
function depRow(d: DepartureEvent, now: number): {
  secondary: string;
  time: string;
  timeClass: string;
} {
  const secondary = flightStatusLabel({ ac: { onGround: true, gs: d.gsKt ?? 0 }, departure: d }).label ?? "";
  if (d.phase === "holding") {
    return {
      secondary,
      time: d.holdingSinceMs != null ? formatDuration((now - d.holdingSinceMs) / 1000) : "—",
      timeClass: "text-status-departure",
    };
  }
  if (d.phase === "roll") {
    return {
      secondary,
      time: d.waitedMs != null ? formatDuration(d.waitedMs / 1000) : "now",
      timeClass: "text-status-cleared",
    };
  }
  return { secondary, time: "↑", timeClass: "text-on-surface-variant" };
}
