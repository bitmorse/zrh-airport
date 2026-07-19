import { STRIPS } from "../domain/runways";
import {
  departingNow,
  nextArrivalByStrip,
  type Arrival,
} from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";

function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total <= 5) return "landing";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Per-runway next-landing board with live countdowns, plus a "departing now"
 * section. Arrival ETAs are estimated from each aircraft's distance-to-threshold
 * and groundspeed and re-computed each poll — an estimate, not a schedule.
 */
export function ArrivalsBoard({
  aircraft,
  lastUpdated,
  now,
  stale,
  selectedHex,
  onSelect,
}: {
  aircraft: AircraftWithAssignment[];
  lastUpdated: number | null;
  now: number;
  stale?: boolean;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const byStrip = nextArrivalByStrip(aircraft);
  const departures = departingNow(aircraft);
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
        {departures.length === 0 ? (
          <div className="text-xs text-slate-600">none detected</div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {departures.map((d) => (
              <span
                key={d.hex}
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300"
                title={`departing runway ${d.end}`}
              >
                {d.callsign} · {d.end}↑
              </span>
            ))}
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
  const remaining = arrival ? Math.max(0, arrival.etaSeconds - ageSec) : null;
  const soon = remaining != null && remaining <= 60 && !stale;
  const isSelected = !!arrival && arrival.hex === selectedHex;
  const clickable = !!arrival && !!onSelect;

  const inner = (
    <>
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
    </>
  );

  const base = `flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left ${
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
