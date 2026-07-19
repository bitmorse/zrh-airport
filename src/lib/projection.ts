import type { LatLon } from "../domain/runways";
import { ZRH_ARP } from "../domain/runways";
import { toLocalMeters } from "./geo";

/**
 * A distortion-free projection from WGS84 to SVG coordinates for the ZRH area.
 * Everything is projected to local metres around the ARP, then linearly scaled
 * with north pointing up. Equal x/y scale keeps runway angles true.
 */

// Half-extent of the visible world, in metres east / north of the ARP. Sized to
// frame the runways prominently while still showing short finals; aircraft on
// long final beyond the frame are simply not drawn.
const HALF_EAST_M = 7000;
const HALF_NORTH_M = 6300;

const SCALE = 0.07; // px per metre

export const SVG_W = Math.round(2 * HALF_EAST_M * SCALE); // 1000
export const SVG_H = Math.round(2 * HALF_NORTH_M * SCALE); // 900

export interface Point {
  x: number;
  y: number;
}

export function projectToSvg(p: LatLon): Point {
  const v = toLocalMeters(ZRH_ARP, p);
  return {
    x: (v.x + HALF_EAST_M) * SCALE,
    y: (HALF_NORTH_M - v.y) * SCALE, // flip so north is up
  };
}

/** True if the point is within the SVG viewport (with an optional margin). */
export function inViewport(pt: Point, margin = 0): boolean {
  return (
    pt.x >= -margin &&
    pt.x <= SVG_W + margin &&
    pt.y >= -margin &&
    pt.y <= SVG_H + margin
  );
}
