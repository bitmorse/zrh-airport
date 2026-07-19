import { STRIPS } from "../domain/runways";
import type { DepartureEvent, DeparturePhase } from "../domain/departures";
import { nextArrivalByStrip, type Arrival } from "../domain/predictions";
import { useFlightRoute } from "../hooks/useFlightRoute";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { formatEta, routeText } from "../lib/format";

const DEP_STYLE: Record<DeparturePhase, { label: string; cls: string }> = {
  holding: { label: "holding", cls: "bg-slate-700/40 text-slate-300" },
  roll: { label: "🛫 rolling", cls: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" },
  climb: { label: "↑ climb", cls: "bg-amber-500/15 text-amber-300" },
};
const DEP_ORDER: Record<DeparturePhase, number> = { roll: 0, holding: 1, climb: 2 };

/**
 * Per-runway next-landing board with live countdowns and looked-up airline/route,
 * plus a "departing now" section. Arrival ETAs are estimated from each aircraft's
 * distance-to-threshold and groundspeed and re-computed each poll — an estimate.
 */
export function ArrivalsBoard({
  aircraft,
  departures,
  lastUpdated,
  now,
  stale,
  selectedHex,
  onSelect,
}: {
  aircraft: AircraftWithAssignment[];
  departures: DepartureEvent[];
  lastUpdated: number | null;
  now: number;
  stale?: boolean;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const byStrip = nextArrivalByStrip(aircraft);
  const deps = [...departures].sort(
    (a, b) => DEP_ORDER[a.phase] - DEP_ORDER[b.phase],
  );
  const ageSec = lastUpdated != null ? (now - lastUpdated) / 1000 : 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Next landing</h2>
        <p className="text-[11px] text-slate-500">estimated from speed &amp; distance</p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {STRIPS.map((strip) => (
          <StripRow
            key={strip.name}
            strip={strip.name}
            arrival={byStrip[strip.name]}
            ageSec={ageSec}
            stale={stale}
            selectedHex={selectedHex}
            onSelect={onSelect}
          />
        ))}
      </ul>

      <div className="border-t border-slate-800 pt-2">
        <div className="text-[11px] font-medium text-slate-400">Departing now</div>
        {deps.length === 0 ? (
          <div className="text-xs text-slate-600">none detected</div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {deps.map((d) => {
              const s = DEP_STYLE[d.phase];
              const chip = (
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${s.cls}`}
                  title={`runway ${d.end} — ${s.label}`}
                >
                  {d.callsign} · {d.end} {s.label}
                </span>
              );
              return onSelect ? (
                <button key={d.hex} type="button" onClick={() => onSelect(d.hex)}>
                  {chip}
                </button>
              ) : (
                <span key={d.hex}>{chip}</span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StripRow({
  strip,
  arrival,
  ageSec,
  stale,
  selectedHex,
  onSelect,
}: {
  strip: string;
  arrival: Arrival | undefined;
  ageSec: number;
  stale?: boolean;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const route = useFlightRoute(arrival?.callsign ?? null);
  const remaining = arrival ? Math.max(0, arrival.etaSeconds - ageSec) : null;
  const soon = remaining != null && remaining <= 60 && !stale;
  const isSelected = !!arrival && arrival.hex === selectedHex;
  const clickable = !!arrival && !!onSelect;
  const routeLabel = routeText(route.data);

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="w-12 shrink-0 font-mono text-sm font-semibold text-slate-200">
            {strip}
          </span>
          {arrival ? (
            <span className="truncate text-xs text-slate-400">
              <span className="text-sky-300">{arrival.end}</span> · {arrival.callsign} ·{" "}
              {arrival.distanceNm.toFixed(1)} NM
            </span>
          ) : (
            <span className="text-xs text-slate-600">— no inbound</span>
          )}
        </div>
        {remaining != null && (
          <span
            className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
              stale ? "text-slate-600" : soon ? "text-emerald-300" : "text-slate-300"
            }`}
            title={stale ? "data is stale" : undefined}
          >
            {stale ? "—" : formatEta(remaining)}
          </span>
        )}
      </div>
      {arrival && routeLabel && (
        <div className="truncate pl-14 text-[11px] text-slate-500">{routeLabel}</div>
      )}
    </>
  );

  const base = `flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${
    isSelected ? "bg-sky-600/20 ring-1 ring-sky-500/50" : "bg-slate-800/40"
  }`;

  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={() => onSelect!(arrival!.hex)}
          className={`${base} hover:bg-slate-800`}
        >
          {inner}
        </button>
      ) : (
        <div className={base}>{inner}</div>
      )}
    </li>
  );
}
