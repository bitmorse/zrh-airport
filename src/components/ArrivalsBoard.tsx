import type { DepartureEvent, DeparturePhase } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useSettings } from "../hooks/useSettings";
import { formatDistance, formatDuration, formatEta } from "../lib/format";
import { elapsedSec, reckonDistanceNm } from "../lib/reckon";

const DEP_ORDER: Record<DeparturePhase, number> = { roll: 0, holding: 1, climb: 2 };

function depState(d: DepartureEvent, now: number): { text: string; cls: string } {
  if (d.phase === "holding") {
    const w = d.holdingSinceMs != null ? ` ${formatDuration((now - d.holdingSinceMs) / 1000)}` : "";
    return { text: `waiting${w}`, cls: "text-amber-300" };
  }
  if (d.phase === "roll") {
    const held = d.waitedMs != null ? ` ${formatDuration(d.waitedMs / 1000)}` : "";
    return { text: `cleared${held}`, cls: "text-emerald-300" };
  }
  return { text: "climbing", cls: "text-slate-400" };
}

function groupSorted<T>(items: T[], key: (t: T) => string, cmp: (a: T, b: T) => number) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const arr = m.get(key(it));
    if (arr) arr.push(it);
    else m.set(key(it), [it]);
  }
  for (const arr of m.values()) arr.sort(cmp);
  return m;
}

interface Row {
  key: string;
  hex: string;
  end: string;
  dir: "↓" | "↑";
  callsign: string;
  type: string | null;
  mid: string;
  extra: number;
  right: { text: string; cls: string };
  sortA: number;
  sortB: number;
}

/**
 * Runway-status board: what each active runway end is doing right now, with an
 * active-configuration header — complementary to the top bar's single next-movement
 * glance. Arrival ETAs are estimated from speed & distance, re-computed each poll.
 */
export function ArrivalsBoard({
  arrivals,
  departures,
  aircraft,
  now,
  lastUpdated,
  stale,
  selectedHex,
  onSelect,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  aircraft: AircraftWithAssignment[];
  now: number;
  lastUpdated: number | null;
  stale?: boolean;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const [{ units }] = useSettings();
  const typeByHex = new Map(aircraft.map((w) => [w.ac.hex, w.ac.type]));
  const ageSec = elapsedSec(lastUpdated, now);

  const arrByEnd = groupSorted(arrivals, (a) => a.end, (x, y) => x.etaSeconds - y.etaSeconds);
  const depByEnd = groupSorted(
    departures,
    (d) => d.end,
    (x, y) => DEP_ORDER[x.phase] - DEP_ORDER[y.phase],
  );

  const rows: Row[] = [];
  for (const [end, list] of arrByEnd) {
    const a = list[0];
    const remaining = Math.max(0, a.etaSeconds - ageSec);
    rows.push({
      key: `a${end}`,
      hex: a.hex,
      end,
      dir: "↓",
      callsign: a.callsign,
      type: typeByHex.get(a.hex) ?? null,
      mid:
        a.distanceNm > 0
          ? formatDistance(reckonDistanceNm(a.distanceNm, a.gsKt, ageSec), units)
          : "",
      extra: list.length - 1,
      right: {
        text: stale ? "—" : formatEta(remaining),
        cls: stale ? "text-slate-600" : remaining <= 60 ? "text-emerald-300" : "text-slate-300",
      },
      sortA: 0,
      sortB: remaining,
    });
  }
  for (const [end, list] of depByEnd) {
    const d = list[0];
    rows.push({
      key: `d${end}`,
      hex: d.hex,
      end,
      dir: "↑",
      callsign: d.callsign,
      type: typeByHex.get(d.hex) ?? null,
      mid: "",
      extra: list.length - 1,
      right: depState(d, now),
      sortA: 1,
      sortB: DEP_ORDER[d.phase],
    });
  }
  rows.sort((x, y) => x.sortA - y.sortA || x.sortB - y.sortB);

  const landingEnds = [...arrByEnd.keys()];
  const departingEnds = [...depByEnd.keys()];

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-200">Runway status</h2>
        <span className="text-[11px] tabular-nums">
          {landingEnds.length > 0 && (
            <span className="text-slate-400">↓ {landingEnds.join(" · ")}</span>
          )}
          {departingEnds.length > 0 && (
            <span className="ml-2 text-slate-400">↑ {departingEnds.join(" · ")}</span>
          )}
          {landingEnds.length === 0 && departingEnds.length === 0 && (
            <span className="text-slate-600">quiet</span>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-600">No active runway movements.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => {
            const selected = r.hex === selectedHex;
            const cls = `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
              selected ? "bg-sky-600/20 ring-1 ring-sky-500/50" : "bg-slate-800/40"
            } ${onSelect ? "hover:bg-slate-800" : ""}`;
            const body = (
              <>
                <span className="w-10 shrink-0 font-mono text-sm font-semibold text-sky-300">
                  {r.end}
                </span>
                <span className="shrink-0 text-slate-500">{r.dir}</span>
                <span className="min-w-0 flex-1 truncate text-xs">
                  <span className="font-semibold text-slate-200">{r.callsign}</span>
                  {r.type && <span className="text-slate-500"> · {r.type}</span>}
                  {r.mid && <span className="text-slate-500"> · {r.mid}</span>}
                  {r.extra > 0 && <span className="text-slate-600"> +{r.extra}</span>}
                </span>
                <span className={`shrink-0 font-mono text-sm tabular-nums ${r.right.cls}`}>
                  {r.right.text}
                </span>
              </>
            );
            return (
              <li key={r.key}>
                {onSelect ? (
                  <button type="button" onClick={() => onSelect(r.hex)} className={cls}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] text-slate-600">
        estimated from speed &amp; distance · re-computed each update
      </p>
    </div>
  );
}
