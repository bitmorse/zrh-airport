import { toLocalMeters, type LatLon } from "./geo";

/**
 * A distortion-free projection from WGS84 to SVG coordinates, centred on an
 * airport reference point (`arp`). Everything is projected to local metres around
 * the ARP, then linearly scaled with north pointing up. Equal x/y scale keeps
 * runway angles true. The world extent is airport-independent, so the same SVG
 * frame and glyph sizes work for any airport.
 */

// Half-extent of the *world*, in metres east / north of the ARP. Large enough to
// cover ~15 NM finals in any direction; the default zoom (see useSettings) frames
// the runways, and zooming out reveals inbound traffic on long final. Keeping the
// same SCALE means every SVG-unit size (runways, glyphs, labels) is unchanged —
// only the world (and thus the zoom-out range) grows.
const HALF_EAST_M = 28000;
const HALF_NORTH_M = 25000;

const SCALE = 0.07; // px per metre

export const SVG_W = Math.round(2 * HALF_EAST_M * SCALE); // 3920
export const SVG_H = Math.round(2 * HALF_NORTH_M * SCALE); // 3500

export interface Point {
  x: number;
  y: number;
}

export function projectToSvg(arp: LatLon, p: LatLon): Point {
  const v = toLocalMeters(arp, p);
  return {
    x: (v.x + HALF_EAST_M) * SCALE,
    y: (HALF_NORTH_M - v.y) * SCALE, // flip so north is up
  };
}

/** Convert a length in metres to SVG units (equal x/y scale, so distances are true). */
export function metersToSvg(m: number): number {
  return m * SCALE;
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
