/**
 * Geofence around the observer's GPS location for auto audio-recording: which
 * aircraft are close enough (and low enough to be heard) to be "in the fence", and
 * whether a tracked target is still inside. Pure — the trigger hook drives recording
 * from these. Reuses `haversineMeters` and the shared `heightAglFt` so distance/height
 * aren't re-derived here. (A coarse ceiling gate, so baro is enough — this data view
 * carries no GNSS altitude and `heightAglFt` falls back to baro accordingly.)
 */
import type { Aircraft } from "../data/adsb";
import { haversineMeters, type LatLon } from "../lib/geo";
import { heightAglFt } from "./gpws";

/** Ignore aircraft higher than this above the field — too high to hear on the ground. */
export const FENCE_CEILING_FT = 10000;

/** Hysteresis: a tracked target stays "inside" until it passes radius + this margin. */
export const FENCE_EXIT_MARGIN_M = 200;

type FenceAircraft = Pick<Aircraft, "hex" | "lat" | "lon" | "onGround" | "altFt">;

/**
 * Aircraft within `radiusM` horizontally of `user` AND no higher than `ceilingFt`
 * above the field, nearest first. The altitude gate keeps cruise overflights (which
 * are within a ground radius but inaudible) from triggering recordings.
 */
export function insideFence(
  user: LatLon,
  radiusM: number,
  aircraft: FenceAircraft[],
  fieldElevationFt: number,
  ceilingFt: number = FENCE_CEILING_FT,
): { hex: string; distM: number }[] {
  return aircraft
    .filter((a) => heightAglFt(a, fieldElevationFt) <= ceilingFt)
    .map((a) => ({ hex: a.hex, distM: haversineMeters(user, { lat: a.lat, lon: a.lon }) }))
    .filter((a) => a.distM <= radiusM)
    .sort((x, y) => x.distM - y.distM);
}

/**
 * Is the tracked target still inside the fence? Uses a small exit margin so an
 * aircraft loitering on the boundary doesn't rapidly start/stop recording. A missing
 * target (gone from the feed) or one now above the ceiling counts as outside.
 */
export function stillInFence(
  user: LatLon,
  radiusM: number,
  ac: FenceAircraft | undefined,
  fieldElevationFt: number,
  ceilingFt: number = FENCE_CEILING_FT,
  exitMarginM: number = FENCE_EXIT_MARGIN_M,
): boolean {
  if (!ac) return false;
  if (heightAglFt(ac, fieldElevationFt) > ceilingFt) return false;
  return haversineMeters(user, { lat: ac.lat, lon: ac.lon }) <= radiusM + exitMarginM;
}
