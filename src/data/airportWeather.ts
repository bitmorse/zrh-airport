/**
 * Client for the backend weather API (see backend/api.md → GET /{icao}/weather):
 * server-collected hourly weather (recent observed + near-term forecast) from
 * Open-Meteo. Used only by the optional wind overlay, so it's fetched lazily and
 * never on the render hot path. Read-only, public, cacheable.
 */
import { STATS_BASE_URL } from "./airportStats";

/** One hour of weather. Every field beyond the timestamp may be null (source gaps). */
export interface WeatherHour {
  /** Start of the hour, epoch ms UTC. Past = observed, future = forecast. */
  tsUtc: number;
  /** Wind **from** direction at the surface, degrees true. */
  windDir: number | null;
  /** Sustained wind speed, knots. */
  windKt: number | null;
  /** Wind gust, knots. */
  gustKt: number | null;
  /** Wind aloft at 80 m: speed (kt) and from-direction (° true). */
  windKt80m: number | null;
  windDir80m: number | null;
  /** Temperature, °C. */
  tempC: number | null;
}

export interface AirportWeather {
  hours: WeatherHour[];
  /** Server build time, epoch ms UTC. */
  generatedAt: number;
}

interface RawHour {
  tsUtc?: number;
  windDir?: number | null;
  windKt?: number | null;
  gustKt?: number | null;
  windKt80m?: number | null;
  windDir80m?: number | null;
  tempC?: number | null;
}

/** Coerce to a finite number, else null (weather fields are legitimately nullable). */
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Fetch hourly weather for an airport. `days` bounds how far back to include;
 * forecast hours ahead of now are always returned. ICAO is case-insensitive.
 * Throws on non-2xx. Parsed defensively (any field may be missing/null).
 */
export async function fetchAirportWeather(
  icao: string,
  days = 2,
  signal?: AbortSignal,
): Promise<AirportWeather> {
  const url = `${STATS_BASE_URL}/${encodeURIComponent(icao)}/weather?days=${days}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`airport weather ${res.status}`);
  const data = (await res.json()) as { hours?: RawHour[]; generatedAt?: number };
  const hours: WeatherHour[] = (data.hours ?? []).map((h) => ({
    tsUtc: num(h.tsUtc) ?? 0,
    windDir: num(h.windDir),
    windKt: num(h.windKt),
    gustKt: num(h.gustKt),
    windKt80m: num(h.windKt80m),
    windDir80m: num(h.windDir80m),
    tempC: num(h.tempC),
  }));
  return { hours, generatedAt: num(data.generatedAt) ?? 0 };
}

/** The current surface wind: direction (° true from), speed and gust (kt). */
export interface CurrentWind {
  dirDeg: number;
  kt: number;
  gustKt: number | null;
  /** Wind aloft at 80 m, when available. */
  dir80: number | null;
  kt80: number | null;
}

/**
 * Pick the weather hour in effect at `nowMs`: the most recent hour whose start is
 * at or before now (falling back to the earliest available if all are in the
 * future). Returns null if there's no usable wind reading (no rows, or the chosen
 * hour lacks direction/speed).
 */
export function currentWind(weather: AirportWeather | undefined, nowMs: number): CurrentWind | null {
  if (!weather || weather.hours.length === 0) return null;
  let chosen: WeatherHour | null = null;
  for (const h of weather.hours) {
    if (h.tsUtc <= nowMs && (chosen === null || h.tsUtc > chosen.tsUtc)) chosen = h;
  }
  // All hours in the future (unusual): fall back to the earliest.
  if (chosen === null) {
    for (const h of weather.hours) {
      if (chosen === null || h.tsUtc < chosen.tsUtc) chosen = h;
    }
  }
  if (chosen === null || chosen.windDir == null || chosen.windKt == null) return null;
  return {
    dirDeg: chosen.windDir,
    kt: chosen.windKt,
    gustKt: chosen.gustKt,
    dir80: chosen.windDir80m,
    kt80: chosen.windKt80m,
  };
}
