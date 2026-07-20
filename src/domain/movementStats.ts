/**
 * The airport's traffic history, bucketed by local hour-of-day **and runway end**, so
 * the UI can draw a per-runway "popular times"–style chart of landings and takeoffs.
 * Stored locally (IndexedDB) per airport; the pure helpers here fold movements into
 * the log, aggregate it per runway, and prune old buckets.
 */
import { get, set } from "idb-keyval";
import type { Movement } from "./movements";

/** Landings (`l`) and takeoffs (`t`) counted in one airport-local hour on one end. */
export interface HourCount {
  l: number;
  t: number;
}

/**
 * Bucketed movement history: local-hour key (`YYYY-MM-DDTHH`) → runway end → counts.
 * Splitting by end is why the store key is versioned — older logs aggregated across
 * runways and have an incompatible shape.
 */
export type MovementLog = Record<string, Record<string, HourCount>>;

/** One hour-of-day (0..23) aggregated across every observed day, for one runway. */
export interface HourStat {
  hour: number;
  landings: number;
  takeoffs: number;
  /** Distinct calendar days on which this hour saw any movement on this end. */
  days: number;
}

/** A single runway end's 24-hour profile plus its totals. */
export interface RunwayHistogram {
  end: string;
  hours: HourStat[];
  landings: number;
  takeoffs: number;
  days: number;
}

export interface MovementSummary {
  days: number;
  landings: number;
  takeoffs: number;
}

const RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const storeKey = (icao: string) => `zrh:movements:v2:${icao}`;

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

/** Fold new movements into the log, split by runway end (pure — returns a fresh object). */
export function applyMovements(
  log: MovementLog,
  movements: Movement[],
  timeZone?: string,
): MovementLog {
  if (movements.length === 0) return log;
  const next: MovementLog = { ...log };
  for (const m of movements) {
    const key = bucketKey(m.ts, timeZone);
    const bucket = { ...(next[key] ?? {}) };
    const cur = bucket[m.end] ?? { l: 0, t: 0 };
    bucket[m.end] =
      m.kind === "landing"
        ? { l: cur.l + 1, t: cur.t }
        : { l: cur.l, t: cur.t + 1 };
    next[key] = bucket;
  }
  return next;
}

/** Drop buckets older than the retention window (pure). */
export function pruneLog(log: MovementLog, nowMs: number, timeZone?: string): MovementLog {
  const cutoff = bucketKey(nowMs - RETENTION_DAYS * DAY_MS, timeZone).slice(0, 10);
  const out: MovementLog = {};
  for (const [key, bucket] of Object.entries(log)) {
    if (key.slice(0, 10) >= cutoff) out[key] = bucket;
  }
  return out;
}

/**
 * Aggregate the log into one 24-hour histogram per runway end, busiest end first
 * (pure). Each end's `hours[h]` totals landings/takeoffs and counts the distinct
 * days that end-hour was seen (for the average-per-day view).
 */
export function byRunway(log: MovementLog): RunwayHistogram[] {
  const ends = new Set<string>();
  for (const bucket of Object.values(log)) {
    for (const end of Object.keys(bucket)) ends.add(end);
  }

  const result: RunwayHistogram[] = [];
  for (const end of ends) {
    const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      landings: 0,
      takeoffs: 0,
      days: 0,
    }));
    const daysByHour = Array.from({ length: 24 }, () => new Set<string>());
    const daysAll = new Set<string>();
    let landings = 0;
    let takeoffs = 0;

    for (const [key, bucket] of Object.entries(log)) {
      const c = bucket[end];
      if (!c) continue;
      const hour = parseInt(key.slice(11, 13), 10);
      if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
      const date = key.slice(0, 10);
      hours[hour].landings += c.l;
      hours[hour].takeoffs += c.t;
      daysByHour[hour].add(date);
      daysAll.add(date);
      landings += c.l;
      takeoffs += c.t;
    }
    for (let h = 0; h < 24; h++) hours[h].days = daysByHour[h].size;
    result.push({ end, hours, landings, takeoffs, days: daysAll.size });
  }

  result.sort(
    (a, b) => b.landings + b.takeoffs - (a.landings + a.takeoffs) || a.end.localeCompare(b.end),
  );
  return result;
}

/** Totals across the whole log (pure). */
export function summarize(log: MovementLog): MovementSummary {
  const days = new Set<string>();
  let landings = 0;
  let takeoffs = 0;
  for (const [key, bucket] of Object.entries(log)) {
    days.add(key.slice(0, 10));
    for (const c of Object.values(bucket)) {
      landings += c.l;
      takeoffs += c.t;
    }
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
