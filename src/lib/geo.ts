const R_EARTH = 6371000; // metres
const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Planar point in local metres (east, north) relative to some origin. */
export interface Vec2 {
  x: number; // east
  y: number; // north
}

/**
 * Equirectangular projection to local metres around `origin`. Accurate to well
 * under a metre over the ~30 km area we care about, and cheap.
 */
export function toLocalMeters(origin: LatLon, p: LatLon): Vec2 {
  const latRad = origin.lat * DEG;
  return {
    x: (p.lon - origin.lon) * DEG * R_EARTH * Math.cos(latRad),
    y: (p.lat - origin.lat) * DEG * R_EARTH,
  };
}

/**
 * Point reached by travelling `distanceM` metres from `origin` on `bearingDeg`
 * (equirectangular approximation — fine over the local area).
 */
export function destinationPoint(
  origin: LatLon,
  bearingDeg: number,
  distanceM: number,
): LatLon {
  const latRad = origin.lat * DEG;
  const east = Math.sin(bearingDeg * DEG) * distanceM;
  const north = Math.cos(bearingDeg * DEG) * distanceM;
  return {
    lat: origin.lat + (north / R_EARTH) / DEG,
    lon: origin.lon + (east / (R_EARTH * Math.cos(latRad))) / DEG,
  };
}

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function angleDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export interface SegmentProjection {
  /** Perpendicular distance from the point to the (infinite) line, metres. */
  crossTrack: number;
  /**
   * Signed distance of the foot of the perpendicular along the segment from `a`,
   * where 0 is at `a` and `len` is at `b`. Negative or > len means the foot is
   * beyond the segment ends (i.e. on the extended centreline).
   */
  alongTrack: number;
  /** Length of the segment a→b, metres. */
  len: number;
}

/**
 * Project point `p` onto the segment a→b, all in local metres. Used to test how
 * close an aircraft is to a runway centreline and where along it (or its extended
 * approach corridor) it sits.
 */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): SegmentProjection {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby) || 1e-9;
  const ux = abx / len;
  const uy = aby / len;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const alongTrack = apx * ux + apy * uy;
  // Perpendicular component magnitude via 2D cross product.
  const crossTrack = Math.abs(apx * uy - apy * ux);
  return { crossTrack, alongTrack, len };
}
