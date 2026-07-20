import type { DepartureEvent, DeparturePhase } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { formatDuration, formatEta, routePairText } from "../lib/format";
import { elapsedSec } from "../lib/reckon";
import { LandingIcon, SquareIcon, TakeoffIcon } from "./icons";

/** Join short glanceable tokens with a middot, dropping empties. */
const secondaryOf = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ") || undefined;

// Cleared (roll) and climbing aircraft are the live action — show them ahead of
// aircraft still waiting at the hold, and drop waiting rows first when space is tight.
const DEP_ORDER: Record<DeparturePhase, number> = { roll: 0, climb: 1, holding: 2 };
const MAX_DEP_ROWS = 3;
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
          <span className="font-semibold text-status-arrival">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              RWY
            </span>{" "}
            {end}
          </span>
          <span className="font-semibold text-on-surface"> {callsign}</span>
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

/** Per-phase secondary label, right-aligned timer and its colour. */
function depRow(d: DepartureEvent, now: number): {
  secondary: string;
  time: string;
  timeClass: string;
} {
  if (d.phase === "holding") {
    return {
      secondary: "waiting",
      time: d.holdingSinceMs != null ? formatDuration((now - d.holdingSinceMs) / 1000) : "—",
      timeClass: "text-status-departure",
    };
  }
  if (d.phase === "roll") {
    return {
      secondary: "cleared",
      time: d.waitedMs != null ? formatDuration(d.waitedMs / 1000) : "now",
      timeClass: "text-status-cleared",
    };
  }
  return { secondary: "climbing", time: "↑", timeClass: "text-on-surface-variant" };
}

/**
 * Compact traffic strip shown above the map on mobile: the soonest arrival plus the
 * most-imminent departures, all as one unified list of identical rows (runway ·
 * callsign · state, with a right-aligned timer). Rows are tappable to select.
 */
export function TrafficBar({
  arrivals,
  departures,
  aircraft = [],
  now,
  lastUpdated,
  stale,
  selectedHex,
  onSelect,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  aircraft?: AircraftWithAssignment[];
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const soonest = arrivals[0];
  const typeByHex = new Map(aircraft.map((w) => [w.ac.hex, w.ac.type]));
  const route = useFlightRoute(soonest?.callsign ?? null);
  const routePair = routePairText(route.data);
  const ageSec = elapsedSec(lastUpdated, now);
  const remaining = soonest ? Math.max(0, soonest.etaSeconds - ageSec) : null;
  const soon = remaining != null && remaining <= 60 && !stale;
  const flash =
    soonest?.flash != null && now - soonest.flash.atMs <= FLASH_SHOW_MS
      ? soonest.flash.label
      : null;

  const deps = [...departures].sort((a, b) => DEP_ORDER[a.phase] - DEP_ORDER[b.phase]);
  const shown = deps.slice(0, MAX_DEP_ROWS);
  const extra = deps.length - shown.length;

  return (
    <div className="w-full divide-y divide-border overflow-hidden border border-border bg-surface-container-low">
      {soonest ? (
        <TrafficRow
          icon={<LandingIcon size={16} />}
          end={soonest.end}
          callsign={soonest.callsign}
          secondary={
            flash ? (
              <span
                className="inline-flex animate-pulse items-center gap-1 font-semibold text-status-departure"
                title="Approach gate (AGL from GNSS altitude — an estimate)"
              >
                <SquareIcon size={9} /> {flash}
              </span>
            ) : (
              secondaryOf(typeByHex.get(soonest.hex), routePair)
            )
          }
          time={stale ? "—" : formatEta(remaining!)}
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
          selected={soonest.hex === selectedHex}
          onClick={() => onSelect?.(soonest.hex)}
        />
      ) : (
        <TrafficRow icon={<LandingIcon size={16} />} muted="No inbound traffic" />
      )}

      {shown.map((d) => {
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

      {extra > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted">+{extra} more departing</div>
      )}
    </div>
  );
}
