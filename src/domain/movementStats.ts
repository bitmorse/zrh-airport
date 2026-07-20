/**
 * The airport's traffic history, bucketed by local hour-of-day so the UI can draw a
 * "popular times"–style occupancy chart of landings and takeoffs. Stored locally
 * (IndexedDB) per airport; the pure helpers here fold movements into the log,
 * aggregate it, and prune old buckets.
 */
import { get, set } from "idb-keyval";
import type { Movement } from "./movements";

/** Landings (`l`) and takeoffs (`t`) counted in one airport-local hour. */
export interface HourCount {
  l: number;
  t: number;
}

/** Bucketed movement history, keyed by airport-local `YYYY-MM-DDTHH`. */
export type MovementLog = Record<string, HourCount>;

/** One hour-of-day (0..23) aggregated across every observed day. */
export interface HourStat {
  hour: number;
  landings: number;
  takeoffs: number;
  /** Distinct calendar days on which this hour saw any movement. */
  days: number;
}

export interface MovementSummary {
  days: number;
  landings: number;
  takeoffs: number;
}

const RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const storeKey = (icao: string) => `zrh:movements:${icao}`;

/** The airport-local calendar date (`YYYY-MM-DD`) and hour (0..23) for an epoch ms. */
export function localHour(ts: number, timeZone?: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(ts);
  const val = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(val("hour"), 10) % 24; // some engines render midnight as "24"
  return { date: `${val("year")}-${val("month")}-${val("day")}`, hour };
}

function bucketKey(ts: number, timeZone?: string): string {
  const { date, hour } = localHour(ts, timeZone);
  return `${date}T${String(hour).padStart(2, "0")}`;
}

/** Fold new movements into the log (pure — returns a fresh object). */
export function applyMovements(
  log: MovementLog,
  movements: Movement[],
  timeZone?: string,
): MovementLog {
  if (movements.length === 0) return log;
  const next: MovementLog = { ...log };
  for (const m of movements) {
    const key = bucketKey(m.ts, timeZone);
    const cur = next[key] ?? { l: 0, t: 0 };
    next[key] =
      m.kind === "landing"
        ? { l: cur.l + 1, t: cur.t }
        : { l: cur.l, t: cur.t + 1 };
  }
  return next;
}

/** Drop buckets older than the retention window (pure). */
export function pruneLog(log: MovementLog, nowMs: number, timeZone?: string): MovementLog {
  const cutoff = bucketKey(nowMs - RETENTION_DAYS * DAY_MS, timeZone).slice(0, 10);
  const out: MovementLog = {};
  for (const [key, c] of Object.entries(log)) {
    if (key.slice(0, 10) >= cutoff) out[key] = c;
  }
  return out;
}

/** Aggregate the log into a 24-entry hour-of-day histogram (pure). */
export function hourlyHistogram(log: MovementLog): HourStat[] {
  const stats: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    landings: 0,
    takeoffs: 0,
    days: 0,
  }));
  const daysByHour = Array.from({ length: 24 }, () => new Set<string>());
  for (const [key, c] of Object.entries(log)) {
    const hour = parseInt(key.slice(11, 13), 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
    stats[hour].landings += c.l;
    stats[hour].takeoffs += c.t;
    daysByHour[hour].add(key.slice(0, 10));
  }
  for (let h = 0; h < 24; h++) stats[h].days = daysByHour[h].size;
  return stats;
}

/** Totals across the whole log (pure). */
export function summarize(log: MovementLog): MovementSummary {
  const days = new Set<string>();
  let landings = 0;
  let takeoffs = 0;
  for (const [key, c] of Object.entries(log)) {
    days.add(key.slice(0, 10));
    landings += c.l;
    takeoffs += c.t;
  }
  return { days: days.size, landings, takeoffs };
}

// ---- storage (thin wrappers; writes serialized like observations) ----

export async function loadMovementLog(icao: string): Promise<MovementLog> {
  return (await get<MovementLog>(storeKey(icao))) ?? {};
}

let writeChain: Promise<unknown> = Promise.resolve();

async function doRecord(
  icao: string,
  movements: Movement[],
  timeZone: string | undefined,
  nowMs: number,
): Promise<MovementLog> {
  const existing = await loadMovementLog(icao);
  const next = pruneLog(applyMovements(existing, movements, timeZone), nowMs, timeZone);
  await set(storeKey(icao), next);
  return next;
}

/**
 * Append movements to the persisted per-airport log, prune stale buckets, and
 * return the fresh log. Serialized so overlapping polls can't clobber each other's
 * read-modify-write.
 */
export function recordMovements(
  icao: string,
  movements: Movement[],
  timeZone: string | undefined,
  nowMs: number,
): Promise<MovementLog> {
  const result = writeChain.then(() => doRecord(icao, movements, timeZone, nowMs));
  writeChain = result.catch(() => {});
  return result;
}
