import type { DepartureEvent, DeparturePhase } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { formatDuration, formatEta, routePairText } from "../lib/format";
import { elapsedSec } from "../lib/reckon";

/** Join short glanceable tokens with a middot, dropping empties. */
const secondaryOf = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ") || undefined;

const DEP_ORDER: Record<DeparturePhase, number> = { roll: 0, holding: 1, climb: 2 };
const MAX_DEP_ROWS = 3;
const FLASH_SHOW_MS = 6000; // flash an approach gate for ~6 s after the crossing

/** One traffic row — identical layout for arrivals and departures. */
function TrafficRow({
  icon,
  end,
  callsign,
  secondary,
  time,
  timeClass = "text-slate-100",
  muted,
  highlight,
  selected,
  onClick,
}: {
  icon: string;
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
      className={`relative flex w-full items-center gap-2 py-1.5 pr-3 pl-3.5 text-left hover:bg-slate-800/50 disabled:cursor-default disabled:hover:bg-transparent ${
        selected ? "bg-slate-200/[0.07]" : highlight ? "bg-amber-500/10" : ""
      }`}
    >
      {/* Selection cue — a neutral white rail, deliberately not a callout colour. */}
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-slate-100"
        />
      )}
      <span aria-hidden>{icon}</span>
      {muted ? (
        <span className="flex-1 text-xs text-slate-500">{muted}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold text-sky-300">{end}</span>
          <span className="font-semibold text-slate-100"> {callsign}</span>
          {secondary && <span className="text-slate-500"> · {secondary}</span>}
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
      timeClass: "text-amber-300",
    };
  }
  if (d.phase === "roll") {
    return {
      secondary: "cleared",
      time: d.waitedMs != null ? formatDuration(d.waitedMs / 1000) : "now",
      timeClass: "text-emerald-300",
    };
  }
  return { secondary: "climbing", time: "↑", timeClass: "text-slate-400" };
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
    <div className="w-full divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
      {soonest ? (
        <TrafficRow
          icon="🛬"
          end={soonest.end}
          callsign={soonest.callsign}
          secondary={
            flash ? (
              <span
                className="animate-pulse font-semibold text-amber-300"
                title="Approach gate (AGL from GNSS altitude — an estimate)"
              >
                ◈ {flash}
              </span>
            ) : (
              secondaryOf(typeByHex.get(soonest.hex), routePair)
            )
          }
          time={stale ? "—" : formatEta(remaining!)}
          timeClass={
            flash
              ? "text-amber-300"
              : stale
                ? "text-slate-500"
                : soon
                  ? "text-emerald-300"
                  : "text-slate-100"
          }
          highlight={!!flash}
          selected={soonest.hex === selectedHex}
          onClick={() => onSelect?.(soonest.hex)}
        />
      ) : (
        <TrafficRow icon="🛬" muted="No inbound traffic" />
      )}

      {shown.map((d) => {
        const { secondary, time, timeClass } = depRow(d, now);
        return (
          <TrafficRow
            key={d.hex}
            icon="🛫"
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
        <div className="px-3 py-1 text-[11px] text-slate-500">+{extra} more departing</div>
      )}
    </div>
  );
}
