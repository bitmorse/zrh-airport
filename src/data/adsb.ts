import type { LatLon } from "../lib/geo";

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
  /** Geometric (GNSS) altitude above the WGS84 ellipsoid, feet (may be null). */
  altGeomFt: number | null;
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
  /** True when every provider was stale/empty and this is the freshest we could get. */
  stale?: boolean;
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
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  seen_pos?: number;
  t?: string;
  desc?: string;
  r?: string;
}

/**
 * No-key, CORS-enabled, ADSBExchange-compatible providers, tried in order. `base` is the
 * v2 API root; `near` builds the radius query path, and the global point lookups
 * (`/callsign|hex|reg/{value}`, used by the follow-a-flight feature) hang off `base`.
 */
const PROVIDERS: {
  name: string;
  base: string;
  near: (c: LatLon, distNm: number) => string;
}[] = [
  {
    name: "adsb.lol",
    base: "https://api.adsb.lol/v2",
    near: (c, d) => `/lat/${c.lat}/lon/${c.lon}/dist/${d}`,
  },
  {
    name: "adsb.fi",
    base: "https://opendata.adsb.fi/api/v2",
    near: (c, d) => `/lat/${c.lat}/lon/${c.lon}/dist/${d}`,
  },
  {
    name: "airplanes.live",
    base: "https://api.airplanes.live/v2",
    near: (c, d) => `/point/${c.lat}/${c.lon}/${d}`,
  },
];

/** Per-provider request timeout; a slow provider must not block failover. */
const PROVIDER_TIMEOUT_MS = 8000;

/**
 * A feed whose freshest aircraft is older than this (seconds) is treated as stale and
 * we fail over. Near a busy airport the freshest `seenPos` is 0–5 s; only a stuck or
 * fading feed climbs past ~60 s, which clears the sparse-but-live edge case comfortably.
 */
const STALE_SEEN_S = 60;

/**
 * Freshness score for a provider response: the *minimum* `seenPos` across the feed
 * ("how fresh is the freshest aircraft"), lower = better. An empty feed scores Infinity
 * (worst, but still a valid last-resort candidate); a non-empty feed that carries no
 * `seenPos` signal at all scores 0 (treated as fresh, so a provider that omits the field
 * isn't needlessly abandoned).
 */
export function minSeen(aircraft: Aircraft[]): number {
  if (aircraft.length === 0) return Infinity;
  let min = Infinity;
  let sawSignal = false;
  for (const a of aircraft) {
    if (a.seenPos != null) {
      sawSignal = true;
      if (a.seenPos < min) min = a.seenPos;
    }
  }
  return sawSignal ? min : 0;
}

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
    altGeomFt: typeof raw.alt_geom === "number" ? raw.alt_geom : null,
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
 * Fetch aircraft within `distNm` nautical miles of `center`, failing over across
 * providers. Throws only if every provider fails. Callers should keep the last
 * good snapshot visible and surface the error alongside it.
 */
export async function fetchAircraftNear(
  center: LatLon,
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
  // The least-stale response so far, kept in case no provider is fresh (a 200 with empty
  // or stale data is NOT accepted as success — that's what stranded auto mode before).
  let best: TrafficSnapshot | null = null;
  let bestScore = Infinity;

  for (const provider of ordered) {
    try {
      const res = await fetch(provider.base + provider.near(center, distNm), {
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
      const snap: TrafficSnapshot = { aircraft, provider: provider.name, fetchedAt: Date.now() };
      const score = minSeen(aircraft);

      // Fresh and non-empty → use it immediately (honours preferred order, no wasted requests).
      if (aircraft.length > 0 && score <= STALE_SEEN_S) return snap;

      // Stale/empty: remember the freshest candidate and try the next provider. The
      // `best === null` guard lets an empty feed (score Infinity) still become a candidate.
      if (best === null || score < bestScore) {
        best = snap;
        bestScore = score;
      }
      errors.push(
        `${provider.name}: ${aircraft.length === 0 ? "empty" : `stale (min seen ${score}s)`}`,
      );
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`${provider.name}: ${(err as Error).message}`);
    }
  }

  // No fresh provider — return the freshest we saw (flagged stale when it's non-empty but
  // behind), so the map keeps advancing and the UI can badge it rather than erroring.
  if (best) {
    if (bestScore > STALE_SEEN_S && best.aircraft.length > 0) best.stale = true;
    return best;
  }
  throw new Error(`All ADS-B providers failed — ${errors.join("; ")}`);
}

export const PROVIDER_NAMES = PROVIDERS.map((p) => p.name);

/** Global point lookup: which ADSBExchange v2 endpoint to hit for a given key. */
export type LookupKind = "callsign" | "hex" | "reg";

/**
 * Look up aircraft **globally** (not radius-limited) by callsign, hex or registration,
 * failing over across the same providers as {@link fetchAircraftNear}. Returns every
 * match `normalise` accepts (usually 0 or 1); the caller picks. An empty result means the
 * aircraft isn't currently broadcasting / in coverage — not an error — so we return `[]`
 * rather than throw unless every provider errors.
 */
export async function fetchAircraftByLookup(
  kind: LookupKind,
  value: string,
  signal?: AbortSignal,
): Promise<Aircraft[]> {
  const path = `/${kind}/${encodeURIComponent(value.trim().toUpperCase())}`;
  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    try {
      const res = await fetch(provider.base + path, {
        signal: withTimeout(signal, PROVIDER_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        // 404 for an unknown key is a legitimate "no match", not a provider failure.
        if (res.status === 404) return [];
        errors.push(`${provider.name}: HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { ac?: RawAircraft[] };
      const list = Array.isArray(json.ac) ? json.ac : [];
      const aircraft = list.map(normalise).filter((a): a is Aircraft => a !== null);
      if (aircraft.length > 0) return aircraft;
      // Empty from this provider: try the next (coverage differs), else fall through to [].
      errors.push(`${provider.name}: empty`);
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`${provider.name}: ${(err as Error).message}`);
    }
  }
  // At least one provider was reachable but had no match → genuinely not broadcasting now.
  if (errors.some((e) => e.endsWith("empty"))) return [];
  // Otherwise every provider errored (network/HTTP) — surface it.
  throw new Error(`ADS-B lookup failed — ${errors.join("; ")}`);
}
