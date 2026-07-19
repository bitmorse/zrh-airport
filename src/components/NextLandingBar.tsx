import type { Arrival } from "../domain/predictions";
import { useFlightRoute } from "../hooks/useFlightRoute";
import { formatEta, routeText } from "../lib/format";

/**
 * Compact single-line "next landing" bar (soonest arrival across all runways),
 * shown above the map on mobile. Tapping it selects the aircraft.
 */
export function NextLandingBar({
  arrivals,
  now,
  lastUpdated,
  stale,
  onSelect,
}: {
  arrivals: Arrival[];
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  onSelect?: (hex: string) => void;
}) {
  const soonest = arrivals[0];
  const route = useFlightRoute(soonest?.callsign ?? null);
  const routeLabel = routeText(route.data);
  const ageSec = lastUpdated != null ? (now - lastUpdated) / 1000 : 0;
  const remaining = soonest ? Math.max(0, soonest.etaSeconds - ageSec) : null;
  const soon = remaining != null && remaining <= 60 && !stale;

  const wrap =
    "flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2";

  if (!soonest) {
    return (
      <div className={wrap}>
        <span className="text-lg">🛬</span>
        <span className="text-sm text-slate-500">No inbound traffic</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect?.(soonest.hex)}
      className={`${wrap} text-left hover:bg-slate-800/70`}
    >
      <span className="text-lg" aria-hidden>
        🛬
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-100">
          <span className="text-sky-300">RWY {soonest.end}</span> · {soonest.callsign}
          <span className="font-normal text-slate-500">
            {" "}
            · {soonest.distanceNm.toFixed(1)} NM
          </span>
        </div>
        <div className="truncate text-[11px] text-slate-400">
          {routeLabel ?? "looking up route…"}
        </div>
      </div>
      <span
        className={`shrink-0 font-mono text-base font-semibold tabular-nums ${
          stale ? "text-slate-500" : soon ? "text-emerald-300" : "text-slate-100"
        }`}
      >
        {stale ? "—" : formatEta(remaining!)}
      </span>
    </button>
  );
}
