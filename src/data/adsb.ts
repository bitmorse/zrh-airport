import { ZRH_ARP } from "../domain/runways";

/**
 * Normalised aircraft state. Field names follow the readsb / ADSBExchange v2
 * "aircraft.json" schema shared by adsb.lol, adsb.fi and airplanes.live.
 */
export interface Aircraft {
  hex: string;
  flight: string | null;
  lat: number;
  lon: number;
  /** Barometric altitude in feet, or null when the aircraft reports "ground". */
  altFt: number | null;
  onGround: boolean;
  /** Ground speed, knots. */
  gs: number | null;
  /** True track over ground, degrees (0..360). */
  track: number | null;
  /** Vertical rate, feet/min (barometric, or geometric fallback). Positive = climbing. */
  verticalRateFpm: number | null;
  /** Seconds since this position was last updated. */
  seenPos: number | null;
  /** ICAO type designator from the feed's aircraft DB, e.g. "A320" (may be null). */
  type: string | null;
  /** Human type description, e.g. "AIRBUS A-320" (may be null). */
  typeDesc: string | null;
  /** Registration / tail number, e.g. "HB-JCA" (may be null). */
  registration: string | null;
}

export interface TrafficSnapshot {
  aircraft: Aircraft[];
  provider: string;
  fetchedAt: number;
}

/** Point-in-time aircraft state captured with a noise measurement. */
export interface AircraftSnapshot {
  type: string | null;
  typeDesc: string | null;
  registration: string | null;
  gsKt: number | null;
  altFt: number | null;
  track: number | null;
  verticalRateFpm: number | null;
  acLat: number | null;
  acLon: number | null;
}

export function snapshotAircraft(ac: Aircraft): AircraftSnapshot {
  return {
    type: ac.type,
    typeDesc: ac.typeDesc,
    registration: ac.registration,
    gsKt: ac.gs,
    altFt: ac.altFt,
    track: ac.track,
    verticalRateFpm: ac.verticalRateFpm,
    acLat: ac.lat,
    acLon: ac.lon,
  };
}

interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  seen_pos?: number;
  t?: string;
  desc?: string;
  r?: string;
}

/** No-key, CORS-enabled, ADSBExchange-compatible providers, tried in order. */
const PROVIDERS: { name: string; url: (distNm: number) => string }[] = [
  {
    name: "adsb.lol",
    url: (d) => `https://api.adsb.lol/v2/lat/${ZRH_ARP.lat}/lon/${ZRH_ARP.lon}/dist/${d}`,
  },
  {
    name: "adsb.fi",
    url: (d) =>
      `https://opendata.adsb.fi/api/v2/lat/${ZRH_ARP.lat}/lon/${ZRH_ARP.lon}/dist/${d}`,
  },
  {
    name: "airplanes.live",
    url: (d) =>
      `https://api.airplanes.live/v2/point/${ZRH_ARP.lat}/${ZRH_ARP.lon}/${d}`,
  },
];

/** Per-provider request timeout; a slow provider must not block failover. */
const PROVIDER_TIMEOUT_MS = 8000;

/**
 * Combine the caller's abort signal (unmount/refetch) with a timeout so a stalled
 * provider aborts and the loop advances. Falls back gracefully on older engines
 * that lack `AbortSignal.timeout` / `AbortSignal.any`.
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (typeof AbortSignal.timeout !== "function") return signal ?? new AbortController().signal;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal; // very old engine: keep caller signal, skip timeout
}

function normalise(raw: RawAircraft): Aircraft | null {
  if (
    !raw.hex ||
    typeof raw.lat !== "number" ||
    typeof raw.lon !== "number"
  ) {
    return null;
  }
  const onGround = raw.alt_baro === "ground";
  return {
    hex: raw.hex,
    flight: raw.flight?.trim() || null,
    lat: raw.lat,
    lon: raw.lon,
    altFt: onGround || typeof raw.alt_baro !== "number" ? null : raw.alt_baro,
    onGround,
    gs: typeof raw.gs === "number" ? raw.gs : null,
    track: typeof raw.track === "number" ? raw.track : null,
    verticalRateFpm:
      typeof raw.baro_rate === "number"
        ? raw.baro_rate
        : typeof raw.geom_rate === "number"
          ? raw.geom_rate
          : null,
    seenPos: typeof raw.seen_pos === "number" ? raw.seen_pos : null,
    type: raw.t?.trim() || null,
    typeDesc: raw.desc?.trim() || null,
    registration: raw.r?.trim() || null,
  };
}

/**
 * Fetch aircraft within `distNm` nautical miles of ZRH, failing over across
 * providers. Throws only if every provider fails. Callers should keep the last
 * good snapshot visible and surface the error alongside it.
 */
export async function fetchAircraftNearZrh(
  distNm = 25,
  preferred?: string,
  signal?: AbortSignal,
): Promise<TrafficSnapshot> {
  const ordered = preferred
    ? [
        ...PROVIDERS.filter((p) => p.name === preferred),
        ...PROVIDERS.filter((p) => p.name !== preferred),
      ]
    : PROVIDERS;

  const errors: string[] = [];
  for (const provider of ordered) {
    try {
      const res = await fetch(provider.url(distNm), {
        signal: withTimeout(signal, PROVIDER_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        errors.push(`${provider.name}: HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { ac?: RawAircraft[] };
      const list = Array.isArray(json.ac) ? json.ac : [];
      const aircraft = list
        .map(normalise)
        .filter((a): a is Aircraft => a !== null);
      return { aircraft, provider: provider.name, fetchedAt: Date.now() };
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`${provider.name}: ${(err as Error).message}`);
    }
  }
  throw new Error(`All ADS-B providers failed — ${errors.join("; ")}`);
}

export const PROVIDER_NAMES = PROVIDERS.map((p) => p.name);
