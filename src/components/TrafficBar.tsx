import type { DepartureEvent, DeparturePhase } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { useSettings } from "../hooks/useSettings";
import { formatDistance, formatDuration, formatEta, routeText } from "../lib/format";

const DEP_CLS: Record<DeparturePhase, string> = {
  holding: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  roll: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  climb: "bg-slate-700/40 text-slate-300 ring-slate-600/30",
};
const DEP_ORDER: Record<DeparturePhase, number> = { roll: 0, holding: 1, climb: 2 };

/** Compact per-departure timer: live wait while holding, frozen hold at roll. */
function depTimer(d: DepartureEvent, now: number): string {
  if (d.phase === "holding") {
    return d.holdingSinceMs != null
      ? `⏳ ${formatDuration((now - d.holdingSinceMs) / 1000)}`
      : "⏳";
  }
  if (d.phase === "roll") {
    return d.waitedMs != null ? `🛫 ${formatDuration(d.waitedMs / 1000)}` : "🛫";
  }
  return "↑";
}

/**
 * Dense traffic strip shown above the map on mobile: the soonest arrival on one
 * line (RWY · callsign · distance · route + live countdown) and, when present, a
 * scrollable row of departures with their waiting-for-takeoff timers. Both are
 * tappable to select the aircraft.
 */
export function TrafficBar({
  arrivals,
  departures,
  now,
  lastUpdated,
  stale,
  onSelect,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  onSelect?: (hex: string) => void;
}) {
  const soonest = arrivals[0];
  const [{ units }] = useSettings();
  const route = useFlightRoute(soonest?.callsign ?? null);
  const routeLabel = routeText(route.data);
  const ageSec = lastUpdated != null ? (now - lastUpdated) / 1000 : 0;
  const remaining = soonest ? Math.max(0, soonest.etaSeconds - ageSec) : null;
  const soon = remaining != null && remaining <= 60 && !stale;
  const deps = [...departures].sort((a, b) => DEP_ORDER[a.phase] - DEP_ORDER[b.phase]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
      <button
        type="button"
        onClick={() => soonest && onSelect?.(soonest.hex)}
        disabled={!soonest}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default hover:bg-slate-800/50"
      >
        <span aria-hidden>🛬</span>
        {soonest ? (
          <>
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className="font-semibold text-sky-300">{soonest.end}</span>
              <span className="font-semibold text-slate-100"> {soonest.callsign}</span>
              <span className="text-slate-500">
                {" · "}
                {formatDistance(soonest.distanceNm, units)}
                {routeLabel ? ` · ${routeLabel}` : ""}
              </span>
            </span>
            <span
              className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                stale ? "text-slate-500" : soon ? "text-emerald-300" : "text-slate-100"
              }`}
            >
              {stale ? "—" : formatEta(remaining!)}
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-500">No inbound traffic</span>
        )}
      </button>

      {deps.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-800 px-3 py-1.5">
          <span aria-hidden className="shrink-0 text-xs">
            🛫
          </span>
          {deps.map((d) => (
            <button
              key={d.hex}
              type="button"
              onClick={() => onSelect?.(d.hex)}
              title={`runway ${d.end}`}
              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ring-1 ${DEP_CLS[d.phase]}`}
            >
              <span className="font-semibold">{d.end}</span> {d.callsign}{" "}
              {depTimer(d, now)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
