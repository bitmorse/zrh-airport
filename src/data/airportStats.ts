/**
 * Client for the backend movement-stats API (see backend/api.md): server-collected,
 * around-the-clock landing/takeoff history per runway end, far richer than what a
 * single device observes. The response shape lines up with the app's existing
 * aggregate types, so it drops straight into the "Traffic by hour" card.
 *
 * Read-only, public, CORS `*`. Cacheable (max-age 300); fetched on demand, not polled.
 */
import type { HourStat, MovementSummary, RunwayHistogram } from "../domain/movementStats";

export const STATS_BASE_URL = "https://bitmorse.com/airports-api";

/** Look-back window the API retains / clamps to. */
export const STATS_MAX_DAYS = 60;

export interface AirportMovements {
  runways: RunwayHistogram[];
  summary: MovementSummary;
  /** Effective window after the API clamps `days`. */
  windowDays: number;
  /** Server build time, epoch ms UTC. */
  generatedAt: number;
}

// The wire shape (backend/api.md → GET /{icao}/movements). Parsed defensively.
interface RawHour { hour?: number; landings?: number; takeoffs?: number; days?: number }
interface RawEnd {
  end?: string;
  landings?: number;
  takeoffs?: number;
  days?: number;
  hours?: RawHour[];
}
interface RawMovements {
  ends?: RawEnd[];
  totals?: { landings?: number; takeoffs?: number; days?: number };
  windowDays?: number;
  generatedAt?: number;
}

const int = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;

/** Normalise a runway end's hours into exactly 24 slots indexed by local hour. */
function parseHours(raw: RawHour[] | undefined): HourStat[] {
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    landings: 0,
    takeoffs: 0,
    days: 0,
  }));
  for (const h of raw ?? []) {
    const idx = int(h.hour);
    if (idx < 0 || idx > 23) continue;
    hours[idx] = {
      hour: idx,
      landings: int(h.landings),
      takeoffs: int(h.takeoffs),
      days: int(h.days),
    };
  }
  return hours;
}

/**
 * Fetch the per-runway 24-hour histogram for an airport over the last `days`
 * (clamped server-side to [1, 60]). Pass `dow` (0=Sunday..6=Saturday) to restrict
 * to one local weekday ("what it's usually like on a Tuesday"). ICAO is
 * case-insensitive. Throws on non-2xx.
 */
export async function fetchAirportMovements(
  icao: string,
  days = STATS_MAX_DAYS,
  signal?: AbortSignal,
  dow?: number | null,
): Promise<AirportMovements> {
  const dowParam = dow == null ? "" : `&dow=${dow}`;
  const url = `${STATS_BASE_URL}/${encodeURIComponent(icao)}/movements?days=${days}${dowParam}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`airport stats ${res.status}`);
  const data = (await res.json()) as RawMovements;

  const runways: RunwayHistogram[] = (data.ends ?? []).map((e) => ({
    end: String(e.end ?? "?"),
    landings: int(e.landings),
    takeoffs: int(e.takeoffs),
    days: int(e.days),
    hours: parseHours(e.hours),
  }));
  const t = data.totals ?? {};
  return {
    runways,
    summary: { landings: int(t.landings), takeoffs: int(t.takeoffs), days: int(t.days) },
    windowDays: int(data.windowDays) || days,
    generatedAt: int(data.generatedAt),
  };
}

/** One runway end's movement count in the recent window (from GET /{icao}/recent). */
export interface RecentEnd {
  end: string;
  movements: number;
  landings: number;
  takeoffs: number;
}

export interface AirportRecent {
  ends: RecentEnd[];
  minutes: number;
  generatedAt: number;
}

interface RawRecentEnd {
  end?: string;
  movements?: number;
  landings?: number;
  takeoffs?: number;
}

/**
 * Per-runway-end movements in a recent wall-clock window — "which runway is hot right
 * now" for the live heatmap. `minutes` is clamped server-side to [5, 360]. Throws on
 * non-2xx. Parsed defensively.
 */
export async function fetchAirportRecent(
  icao: string,
  minutes = 90,
  signal?: AbortSignal,
): Promise<AirportRecent> {
  const url = `${STATS_BASE_URL}/${encodeURIComponent(icao)}/recent?minutes=${minutes}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`airport recent ${res.status}`);
  const data = (await res.json()) as { ends?: RawRecentEnd[]; minutes?: number; generatedAt?: number };
  const ends: RecentEnd[] = (data.ends ?? []).map((e) => ({
    end: String(e.end ?? "?"),
    movements: int(e.movements),
    landings: int(e.landings),
    takeoffs: int(e.takeoffs),
  }));
  return { ends, minutes: int(data.minutes) || minutes, generatedAt: int(data.generatedAt) };
}

/** Fold a recent-activity response into the heatmap's `Record<endId, movements>`. */
export function recentCountsByEnd(recent: AirportRecent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of recent.ends) out[e.end] = e.movements;
  return out;
}
