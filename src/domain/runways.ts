/**
 * Geometry of Zurich Airport (LSZH / ZRH).
 *
 * Threshold coordinates are taken from the OurAirports `runways.csv` dataset for
 * LSZH (WGS84). Each physical runway has two ends ("thresholds"); an aircraft
 * *landing on 28* touches down at the 28 threshold and rolls toward the 10 end,
 * so we model each runway END separately — that is what we highlight.
 *
 * `bearingDeg` is the true track an aircraft has when landing on / departing from
 * that end (i.e. the compass direction it is travelling over the threshold toward
 * the far end). It matches the runway designator: end "28" ≈ 275°, "10" ≈ 95°.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RunwayEnd {
  /** Runway-end id, e.g. "16", "28". */
  id: string;
  /** The other end of the same physical strip, e.g. "16" <-> "34". */
  opposite: string;
  /** Physical strip name, e.g. "16/34". */
  strip: string;
  /** Threshold (touchdown) coordinate for this end. */
  threshold: LatLon;
  /** Far-end threshold — the direction the aircraft rolls toward. */
  farEnd: LatLon;
  /** True bearing of travel when using this end (deg, 0..360). */
  bearingDeg: number;
}

/** Airport reference point — used as the query centre and projection anchor. */
export const ZRH_ARP: LatLon = { lat: 47.4647, lon: 8.5492 };

// Physical thresholds (OurAirports LSZH runways.csv).
const T = {
  "16": { lat: 47.48047, lon: 8.53619 },
  "34": { lat: 47.44758, lon: 8.5493 },
  "14": { lat: 47.48586, lon: 8.53619 },
  "32": { lat: 47.45463, lon: 8.56494 },
  "10": { lat: 47.45872, lon: 8.52889 },
  "28": { lat: 47.46225, lon: 8.5719 },
} as const;

/**
 * Compute the initial great-circle bearing from `a` to `b` in degrees (0..360).
 */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function makeEnd(id: string, opposite: string, strip: string): RunwayEnd {
  const threshold = T[id as keyof typeof T];
  const farEnd = T[opposite as keyof typeof T];
  const b = bearing(threshold, farEnd);
  return {
    id,
    opposite,
    strip,
    threshold,
    farEnd,
    bearingDeg: (b + 360) % 360,
  };
}

/** All six runway ends at LSZH. */
export const RUNWAY_ENDS: RunwayEnd[] = [
  makeEnd("16", "34", "16/34"),
  makeEnd("34", "16", "16/34"),
  makeEnd("14", "32", "14/32"),
  makeEnd("32", "14", "14/32"),
  makeEnd("10", "28", "10/28"),
  makeEnd("28", "10", "10/28"),
];

export const RUNWAY_END_BY_ID: Record<string, RunwayEnd> = Object.fromEntries(
  RUNWAY_ENDS.map((e) => [e.id, e]),
);

/** The three physical strips, each with its two thresholds. */
export const STRIPS = [
  { name: "16/34", a: T["16"], b: T["34"] },
  { name: "14/32", a: T["14"], b: T["32"] },
  { name: "10/28", a: T["10"], b: T["28"] },
] as const;
