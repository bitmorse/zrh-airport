import {
  localHour,
  type HourStat,
  type MovementSummary,
  type RunwayHistogram,
} from "../domain/movementStats";

/** Which window the chart shows: real last-24 h vs. the ~2-month average. */
export type StatView = "today" | "usual";
type Mode = "avg" | "total";

/** Weekday labels indexed 0=Sunday..6=Saturday (matches the API's `dow`). */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
 * small-multiple per runway end**, bucketed by the airport's local hour-of-day. The
 * aggregated per-runway histograms are supplied by the caller (server-collected
 * history from the stats API, or on-device history as a fallback). Every runway
 * shares a Y scale (labelled, with ticks) so busy and quiet ends are directly
 * comparable. Toggle a typical day (average per observed day) vs. all-time totals.
 */
export function MovementsByHour({
  runways,
  summary,
  timeZone,
  now,
  view,
  onViewChange,
  dow,
  onDowChange,
  loading,
  sourceNote,
}: {
  runways: RunwayHistogram[];
  summary: MovementSummary;
  timeZone?: string;
  now: number;
  /** Real last-24 h ("today") vs. the ~2-month average ("usual"). */
  view: StatView;
  onViewChange: (v: StatView) => void;
  /** Weekday the "usual" view averages (0=Sun..6=Sat), and its setter. */
  dow: number;
  onDowChange: (d: number) => void;
  /** True while the first server fetch is in flight and there's nothing to show yet. */
  loading?: boolean;
  /** Short provenance note appended to the footer (e.g. "server · 60-day history"). */
  sourceNote?: string;
}) {
  // "Today" shows the raw last-24 h counts; "Usual" averages per observed day.
  const mode: Mode = view === "usual" ? "avg" : "total";
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
  const yUnit = view === "usual" ? "movements / day" : "movements · today";

  const empty = summary.landings === 0 && summary.takeoffs === 0;
  const tz = timeZone?.split("/").pop()?.replace(/_/g, " ");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Traffic by hour</h2>
        <div className="flex overflow-hidden border border-border text-[11px]">
          {(["today", "usual"] as StatView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              aria-pressed={view === v}
              className={`px-2 py-0.5 uppercase ${
                view === v
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {v === "today" ? "Today" : "Usual"}
            </button>
          ))}
        </div>
      </div>

      {view === "usual" && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="uppercase tracking-wide text-muted">Weekday</span>
          <div className="flex flex-wrap overflow-hidden border border-border">
            {WEEKDAYS.map((label, d) => (
              <button
                key={label}
                type="button"
                onClick={() => onDowChange(d)}
                aria-pressed={dow === d}
                className={`px-1.5 py-0.5 ${
                  dow === d
                    ? "bg-primary text-on-primary"
                    : "text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {empty ? (
        loading ? (
          <p className="text-xs leading-relaxed text-muted">Loading traffic history…</p>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            No history yet. Landings and takeoffs are counted per runway as they happen —
            check back once the collector has recorded some movements.
          </p>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-on-surface-variant">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 bg-status-arrival" /> landings
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 bg-status-departure" /> takeoffs
            </span>
            <span className="ml-auto text-muted">↕ {yUnit}</span>
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

      <p className="text-[10px] leading-relaxed text-muted">
        {empty
          ? (sourceNote ?? "")
          : `${summary.landings} landings · ${summary.takeoffs} takeoffs over ${summary.days} ${
              summary.days === 1 ? "day" : "days"
            }${tz ? ` · ${tz} local time` : ""}${sourceNote ? ` · ${sourceNote}` : ""}`}
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
        <span className="text-xs font-semibold text-status-arrival">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            RWY
          </span>{" "}
          {rw.end}
        </span>
        <span className="text-[10px] tabular-nums text-muted">
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
            <line
              x1={PLOT_L}
              y1={y(t)}
              x2={PLOT_R}
              y2={y(t)}
              stroke="var(--color-outline-variant)"
              strokeWidth={1}
            />
            <text
              x={PLOT_L - 3}
              y={y(t) + 2.5}
              textAnchor="end"
              fontSize={7}
              fill="var(--color-muted)"
            >
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
          fill="var(--color-surface-container-highest)"
        />

        {/* Grouped landing / takeoff bars per hour. */}
        {rw.hours.map((h) => {
          const v = valueOf(h);
          const cx = PLOT_L + h.hour * SLOT + SLOT / 2;
          return (
            <g key={h.hour}>
              <rect x={cx - bw - gap / 2} y={PLOT_B - barH(v.l)} width={bw} height={barH(v.l)} fill="var(--color-status-arrival)" />
              <rect x={cx + gap / 2} y={PLOT_B - barH(v.t)} width={bw} height={barH(v.t)} fill="var(--color-status-departure)" />
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
            fill="var(--color-muted)"
          >
            {pad(hh)}
          </text>
        ))}
      </svg>
    </div>
  );
}
