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
  /** Seconds since this position was last updated. */
  seenPos: number | null;
}

export interface TrafficSnapshot {
  aircraft: Aircraft[];
  provider: string;
  fetchedAt: number;
}

interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  seen_pos?: number;
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
    seenPos: typeof raw.seen_pos === "number" ? raw.seen_pos : null,
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
    ? [...PROVIDERS].sort((a, b) =>
        a.name === preferred ? -1 : b.name === preferred ? 1 : 0,
      )
    : PROVIDERS;

  const errors: string[] = [];
  for (const provider of ordered) {
    try {
      const res = await fetch(provider.url(distNm), {
        signal,
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
