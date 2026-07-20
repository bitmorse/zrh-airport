import { useState } from "react";
import {
  hourlyHistogram,
  localHour,
  summarize,
  type MovementLog,
} from "../domain/movementStats";

type Mode = "avg" | "total";

/**
 * "Traffic by hour": a popular-times–style chart of landings vs. takeoffs bucketed
 * by the airport's local hour-of-day, built from history collected on this device.
 * Toggle between a typical day (average per observed day) and all-time totals.
 */
export function MovementsByHour({
  log,
  timeZone,
  now,
}: {
  log: MovementLog;
  timeZone?: string;
  now: number;
}) {
  const [mode, setMode] = useState<Mode>("avg");
  const hist = hourlyHistogram(log);
  const summary = summarize(log);
  const nowHour = localHour(now, timeZone).hour;

  const valueOf = (h: (typeof hist)[number]) =>
    mode === "avg"
      ? {
          l: h.days ? h.landings / h.days : 0,
          t: h.days ? h.takeoffs / h.days : 0,
        }
      : { l: h.landings, t: h.takeoffs };

  const max = Math.max(1, ...hist.map((h) => Math.max(valueOf(h).l, valueOf(h).t)));
  const barPct = (v: number) => (v <= 0 ? 0 : Math.max(6, (v / max) * 100));
  const fmt = (v: number) => (mode === "avg" ? v.toFixed(v < 10 ? 1 : 0) : String(v));

  const empty = summary.landings === 0 && summary.takeoffs === 0;
  const tz = timeZone?.split("/").pop()?.replace(/_/g, " ");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-200">Traffic by hour</h2>
        <div className="flex overflow-hidden rounded-md border border-slate-700 text-[11px]">
          {(["avg", "total"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-2 py-0.5 ${
                mode === m ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              {m === "avg" ? "Avg/day" : "Total"}
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <p className="text-xs leading-relaxed text-slate-500">
          No history yet. Landings and takeoffs are counted as they happen and stored on
          this device — leave the tab open to build up a typical-day profile.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-sky-400" /> landings
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-amber-400" /> takeoffs
            </span>
          </div>

          <div className="flex h-24 items-end gap-px" role="img" aria-label="Movements by hour of day">
            {hist.map((h) => {
              const v = valueOf(h);
              const isNow = h.hour === nowHour;
              const title =
                mode === "avg"
                  ? `${pad(h.hour)}:00 — ${fmt(v.l)} landings · ${fmt(v.t)} takeoffs per day (${h.days} ${h.days === 1 ? "day" : "days"})`
                  : `${pad(h.hour)}:00 — ${h.landings} landings · ${h.takeoffs} takeoffs`;
              return (
                <div
                  key={h.hour}
                  title={title}
                  className={`flex h-full flex-1 flex-col justify-end rounded-sm ${
                    isNow ? "bg-slate-700/40" : ""
                  }`}
                >
                  <div className="flex h-full items-end justify-center gap-[1px] px-[1px]">
                    <span
                      className="w-1/2 rounded-t-[1px] bg-sky-400"
                      style={{ height: `${barPct(v.l)}%` }}
                    />
                    <span
                      className="w-1/2 rounded-t-[1px] bg-amber-400"
                      style={{ height: `${barPct(v.t)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between px-[1px] text-[9px] tabular-nums text-slate-600">
            {hist.map((h) => (
              <span key={h.hour} className="flex-1 text-center">
                {h.hour % 6 === 0 ? pad(h.hour) : ""}
              </span>
            ))}
          </div>
        </>
      )}

      <p className="text-[10px] leading-relaxed text-slate-600">
        {empty
          ? "Stored locally · never leaves your device."
          : `${summary.landings} landings · ${summary.takeoffs} takeoffs over ${summary.days} ${
              summary.days === 1 ? "day" : "days"
            }${tz ? ` · ${tz} local time` : ""}`}
      </p>
    </div>
  );
}

const pad = (h: number) => String(h).padStart(2, "0");
