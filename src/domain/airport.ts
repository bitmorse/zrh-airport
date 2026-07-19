import { toLocalMeters, type LatLon, type Vec2 } from "../lib/geo";

/**
 * Generic airport geometry. Everything airport-specific lives in an `AirportConfig`
 * (see `src/data/airports.ts`); `buildAirport` derives the runway ends, strips,
 * bearings and pre-projected centrelines that the rest of the app consumes. No
 * airport is hard-coded anywhere else — swap in a new config and it just works.
 */

export type { LatLon };

export interface RunwayEnd {
  /** Runway-end id, e.g. "16", "28", "02L". */
  id: string;
  /** The other end of the same physical strip, e.g. "16" <-> "34". */
  opposite: string;
  /** Physical strip name, e.g. "16/34". */
  strip: string;
  /** Threshold (touchdown) coordinate for this end. */
  threshold: LatLon;
  /** Far-end threshold — the direction an aircraft rolls toward. */
  farEnd: LatLon;
  /** True bearing of travel when using this end (deg, 0..360). */
  bearingDeg: number;
}

/** One threshold of a physical runway, as authored in a config. */
export interface RunwayEndSpec {
  id: string;
  threshold: LatLon;
}

/** A physical runway: its two opposing thresholds. */
export interface RunwaySpec {
  ends: [RunwayEndSpec, RunwayEndSpec];
}

/** Hand-authored data for one airport (the only place airport specifics live). */
export interface AirportConfig {
  /** ICAO id, e.g. "LSZH". Used as the settings/query key. */
  icao: string;
  /** IATA code, e.g. "ZRH". Shown as the wordmark. */
  iata: string;
  /** Human name, e.g. "Zürich". */
  name: string;
  /** Reference point — query centre and projection anchor (near the field). */
  arp: LatLon;
  /** Field elevation in feet (for altitude-above-field). */
  fieldElevationFt: number;
  runways: RunwaySpec[];
}

/** Derived, ready-to-use geometry for the active airport. */
export interface Airport {
  config: AirportConfig;
  ends: RunwayEnd[];
  endById: Record<string, RunwayEnd>;
  strips: { name: string; a: LatLon; b: LatLon }[];
  stripPairs: [RunwayEnd, RunwayEnd][];
  /** Each end's centreline pre-projected to local metres around the ARP. */
  endsLocal: { end: RunwayEnd; a: Vec2; b: Vec2 }[];
}

/** Initial great-circle bearing from `a` to `b` in degrees (0..360). */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function makeEnd(
  id: string,
  opposite: string,
  strip: string,
  threshold: LatLon,
  farEnd: LatLon,
): RunwayEnd {
  return {
    id,
    opposite,
    strip,
    threshold,
    farEnd,
    bearingDeg: (bearing(threshold, farEnd) + 360) % 360,
  };
}

/** Derive the full runway geometry for an airport from its config. */
export function buildAirport(config: AirportConfig): Airport {
  const ends: RunwayEnd[] = [];
  const strips: Airport["strips"] = [];
  const stripPairs: [RunwayEnd, RunwayEnd][] = [];

  for (const rw of config.runways) {
    const [e0, e1] = rw.ends;
    const name = `${e0.id}/${e1.id}`;
    const end0 = makeEnd(e0.id, e1.id, name, e0.threshold, e1.threshold);
    const end1 = makeEnd(e1.id, e0.id, name, e1.threshold, e0.threshold);
    ends.push(end0, end1);
    strips.push({ name, a: e0.threshold, b: e1.threshold });
    stripPairs.push([end0, end1]);
  }

  const endById: Record<string, RunwayEnd> = Object.fromEntries(
    ends.map((e) => [e.id, e]),
  );
  const endsLocal = ends.map((e) => ({
    end: e,
    a: toLocalMeters(config.arp, e.threshold),
    b: toLocalMeters(config.arp, e.farEnd),
  }));

  return { config, ends, endById, strips, stripPairs, endsLocal };
}
