import type { LatLon } from "./geo";

/**
 * Equirectangular (plate-carrée) projection for the follow-a-flight world map. The whole
 * world is projected **once** into a 360×180 SVG space (1 unit = 1°); panning/zooming to
 * follow the aircraft is then just a viewBox centred on its projected position — the same
 * trick the airport map uses. Simple and dependency-free; distortion near the poles and
 * across the antimeridian is acceptable for a "where's my plane" view (great-circle arcs
 * are split at ±180° so they don't streak across the map).
 */

export interface Pt {
  x: number;
  y: number;
}

/** SVG-space world extent (degrees). Longitude → x (0..360), latitude → y (0..180, N up). */
export const WORLD_W = 360;
export const WORLD_H = 180;

export function project(lon: number, lat: number): Pt {
  return { x: lon + 180, y: 90 - lat };
}

export type Ring = [number, number][];

/** One SVG path string (stroke-only outlines) for all country/coastline rings. */
export function countryPath(rings: Ring[]): string {
  let d = "";
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = project(ring[i][0], ring[i][1]);
      d += (i === 0 ? "M" : "L") + p.x.toFixed(2) + " " + p.y.toFixed(2);
    }
    d += "Z";
  }
  return d;
}

/** Graticule (meridians + parallels) as one path, every `step` degrees. */
export function graticulePath(step = 30): string {
  let d = "";
  for (let lon = -180; lon <= 180; lon += step) {
    const a = project(lon, -85);
    const b = project(lon, 85);
    d += `M${a.x} ${a.y}L${b.x} ${b.y}`;
  }
  for (let lat = -60; lat <= 60; lat += step) {
    const a = project(-180, lat);
    const b = project(180, lat);
    d += `M${a.x} ${a.y}L${b.x} ${b.y}`;
  }
  return d;
}

/**
 * Great-circle path from `a` to `b`, sampled and projected, split into segments wherever
 * it crosses the antimeridian (so equirectangular doesn't draw a line across the world).
 */
export function greatCircleSegments(a: LatLon, b: LatLon, n = 64): Pt[][] {
  const toVec = (p: LatLon): [number, number, number] => {
    const φ = (p.lat * Math.PI) / 180;
    const λ = (p.lon * Math.PI) / 180;
    return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
  };
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const ω = Math.acos(dot);

  const segs: Pt[][] = [];
  let cur: Pt[] = [];
  let prevLon: number | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x: number;
    let y: number;
    let z: number;
    if (ω < 1e-6) {
      [x, y, z] = va;
    } else {
      const s1 = Math.sin((1 - t) * ω) / Math.sin(ω);
      const s2 = Math.sin(t * ω) / Math.sin(ω);
      x = s1 * va[0] + s2 * vb[0];
      y = s1 * va[1] + s2 * vb[1];
      z = s1 * va[2] + s2 * vb[2];
    }
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    cur.push(project(lon, lat));
    prevLon = lon;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** viewBox centred on (lon,lat), `spanDeg` tall, at the given width/height aspect. */
export function followViewBox(lon: number, lat: number, spanDeg: number, aspect: number): string {
  const c = project(lon, lat);
  const h = spanDeg;
  const w = spanDeg * aspect;
  return `${(c.x - w / 2).toFixed(2)} ${(c.y - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
}
