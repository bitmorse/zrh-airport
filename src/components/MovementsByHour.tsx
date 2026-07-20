import { useState } from "react";
import {
  byRunway,
  localHour,
  summarize,
  type HourStat,
  type MovementLog,
  type RunwayHistogram,
} from "../domain/movementStats";

type Mode = "avg" | "total";

// Mini-chart geometry (SVG user units; scales responsively via viewBox).
const CH_W = 240;
const CH_H = 74;
const GUT_L = 22; // left gutter for the Y axis (tick labels)
const PAD_T = 6;
const PAD_B = 12; // bottom room for the hour axis
const PLOT_L = GUT_L;
const PLOT_R = CH_W - 4;
const PLOT_W = PLOT_R - PLOT_L;
const PLOT_T = PAD_T;
const PLOT_B = CH_H - PAD_B;
const PLOT_H = PLOT_B - PLOT_T;
const SLOT = PLOT_W / 24;

const pad = (h: number) => String(h).padStart(2, "0");
const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Round a max up to a clean axis bound (1, 2, 2.5, 5, 10, …). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * "Traffic by hour": a popular-times–style chart of landings vs. takeoffs, **one
 * small-multiple per runway end**, bucketed by the airport's local hour-of-day from
 * history collected on this device. Every runway shares a Y scale (labelled, with
 * ticks) so busy and quiet ends are directly comparable. Toggle a typical day
 * (average per observed day) vs. all-time totals.
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
  const runways = byRunway(log);
  const summary = summarize(log);
  const nowHour = localHour(now, timeZone).hour;

  const valueOf = (h: HourStat) =>
    mode === "avg"
      ? { l: h.days ? h.landings / h.days : 0, t: h.days ? h.takeoffs / h.days : 0 }
      : { l: h.landings, t: h.takeoffs };

  // Shared Y bound across all runways so their bars are comparable.
  let rawMax = 0;
  for (const rw of runways) {
    for (const h of rw.hours) {
      const v = valueOf(h);
      rawMax = Math.max(rawMax, v.l, v.t);
    }
  }
  const axisMax = niceMax(rawMax);
  const ticks = [0, axisMax / 2, axisMax];
  const yUnit = mode === "avg" ? "movements / day" : "movements (total)";

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
          No history yet. Landings and takeoffs are counted per runway as they happen and
          stored on this device — leave the tab open to build up a typical-day profile.
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
            <span className="ml-auto text-slate-500">↕ {yUnit}</span>
          </div>

          <div className="flex flex-col gap-3">
            {runways.map((rw) => (
              <RunwayChart
                key={rw.end}
                rw={rw}
                mode={mode}
                axisMax={axisMax}
                ticks={ticks}
                nowHour={nowHour}
                valueOf={valueOf}
              />
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

function RunwayChart({
  rw,
  mode,
  axisMax,
  ticks,
  nowHour,
  valueOf,
}: {
  rw: RunwayHistogram;
  mode: Mode;
  axisMax: number;
  ticks: number[];
  nowHour: number;
  valueOf: (h: HourStat) => { l: number; t: number };
}) {
  const y = (v: number) => PLOT_B - (v / axisMax) * PLOT_H;
  const barH = (v: number) => (v <= 0 ? 0 : Math.max(1.5, PLOT_B - y(v)));
  const bw = SLOT * 0.36;
  const gap = SLOT * 0.12;
  const total = mode === "avg" && rw.days ? "" : ` · ${rw.landings + rw.takeoffs}`;

  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-sky-300">
          <span className="text-[10px] font-medium uppercase tracking-wide text-sky-300/50">
            RWY
          </span>{" "}
          {rw.end}
        </span>
        <span className="text-[10px] tabular-nums text-slate-500">
          {rw.landings} ↓ · {rw.takeoffs} ↑{total}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CH_W} ${CH_H}`}
        className="w-full"
        role="img"
        aria-label={`Runway ${rw.end} landings and takeoffs by local hour`}
      >
        {/* Y grid + tick labels. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PLOT_L} y1={y(t)} x2={PLOT_R} y2={y(t)} stroke="#1e293b" strokeWidth={1} />
            <text x={PLOT_L - 3} y={y(t) + 2.5} textAnchor="end" fontSize={7} fill="#64748b">
              {fmtTick(t)}
            </text>
          </g>
        ))}

        {/* Current local hour. */}
        <rect
          x={PLOT_L + nowHour * SLOT}
          y={PLOT_T}
          width={SLOT}
          height={PLOT_H}
          fill="#334155"
          opacity={0.4}
        />

        {/* Grouped landing / takeoff bars per hour. */}
        {rw.hours.map((h) => {
          const v = valueOf(h);
          const cx = PLOT_L + h.hour * SLOT + SLOT / 2;
          return (
            <g key={h.hour}>
              <rect x={cx - bw - gap / 2} y={PLOT_B - barH(v.l)} width={bw} height={barH(v.l)} fill="#38bdf8" />
              <rect x={cx + gap / 2} y={PLOT_B - barH(v.t)} width={bw} height={barH(v.t)} fill="#fbbf24" />
            </g>
          );
        })}

        {/* Hour axis ticks. */}
        {[0, 6, 12, 18].map((hh) => (
          <text
            key={hh}
            x={PLOT_L + hh * SLOT + SLOT / 2}
            y={CH_H - 2}
            textAnchor="middle"
            fontSize={7}
            fill="#475569"
          >
            {pad(hh)}
          </text>
        ))}
      </svg>
    </div>
  );
}
