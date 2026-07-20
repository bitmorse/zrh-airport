import { toLocalMeters, type LatLon, type Vec2 } from "./geo";
import type { Point } from "./projection";

export interface FitResult {
  /** The trajectory points projected into the box. */
  pts: Point[];
  /** Same transform, to project extra geometry (e.g. runway centrelines). */
  project: (p: LatLon) => Point;
}

/**
 * Fit a lat/lon path into a `width`×`height` box with `pad` inset, preserving aspect
 * (equal x/y scale, north up), centred. Distortion-free via local-metre projection
 * around the path's first point — the standalone-box analogue of the big map's
 * `projectToSvg`, which is locked to the airport frame. Returns the projected points
 * plus a `project` fn so callers can overlay other geometry in the same space.
 */
export function fitPath(
  points: LatLon[],
  width: number,
  height: number,
  pad = 8,
): FitResult {
  if (points.length === 0) {
    return { pts: [], project: () => ({ x: width / 2, y: height / 2 }) };
  }
  const origin = points[0];
  const locals = points.map((p) => toLocalMeters(origin, p));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of locals) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const iw = Math.max(1, width - 2 * pad);
  const ih = Math.max(1, height - 2 * pad);
  const scale = Math.min(iw / spanX, ih / spanY);
  const offX = pad + (iw - spanX * scale) / 2;
  const offY = pad + (ih - spanY * scale) / 2;

  // Flip Y so north is up.
  const toScreen = (v: Vec2): Point => ({
    x: offX + (v.x - minX) * scale,
    y: offY + (maxY - v.y) * scale,
  });

  return {
    pts: locals.map(toScreen),
    project: (p: LatLon) => toScreen(toLocalMeters(origin, p)),
  };
}
