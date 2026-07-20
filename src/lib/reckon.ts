/**
 * Dead reckoning: extrapolate an aircraft's motion values between ADS-B polls (a
 * few seconds apart) from its rates, so displayed numbers tick smoothly and look
 * live instead of jumping each poll. On the next poll they snap back to the truth.
 */
import type { Aircraft } from "../data/adsb";
import { destinationPoint, type LatLon } from "./geo";

const KT_TO_MS = 0.514444;
const M_TO_NM = 1 / 1852;
const MAX_EXTRAPOLATE_S = 60; // stop dead-reckoning if the feed stalls
// Above this groundspeed a plane on the ground is rolling (takeoff/landing), not
// taxiing — reckon it so a departure glides down the runway instead of freezing.
// Below it we hold position: slow taxi tracks are noisy and would jitter.
const GROUND_RECKON_MIN_KT = 30;

/**
 * The aircraft's estimated position now, advanced along its track at groundspeed
 * since the last poll. The single source of truth shared by the plane glyph and its
 * trajectory trail, so the trail's leading end always meets the icon. Airborne traffic
 * always reckons; ground traffic reckons only once it's rolling fast (a takeoff/landing
 * roll), so a 95 kt departure animates while a slow taxi holds still. Stationary, or
 * without a track/poll time, it returns the raw position.
 */
export function reckonPosition(
  ac: Pick<Aircraft, "lat" | "lon" | "onGround" | "gs" | "track" | "seenPos">,
  lastUpdated: number | null,
  nowMs: number,
): LatLon {
  const pos = { lat: ac.lat, lon: ac.lon };
  if (
    ac.gs == null ||
    ac.gs <= 0 ||
    ac.track == null ||
    lastUpdated == null ||
    (ac.onGround && ac.gs < GROUND_RECKON_MIN_KT) // slow taxi — hold position (noisy)
  ) {
    return pos;
  }
  const ageSec = Math.min(
    MAX_EXTRAPOLATE_S,
    (nowMs - lastUpdated) / 1000 + (ac.seenPos ?? 0),
  );
  if (ageSec <= 0) return pos;
  return destinationPoint(pos, ac.track, ac.gs * KT_TO_MS * ageSec);
}

/** Seconds since the last poll, clamped to ≥ 0. */
export function elapsedSec(lastUpdated: number | null, now: number): number {
  return lastUpdated != null ? Math.max(0, (now - lastUpdated) / 1000) : 0;
}

/** Altitude (ft) advanced by the vertical rate (ft/min) over `elapsedS`. */
export function reckonAltFt(
  altFt: number,
  verticalRateFpm: number | null,
  elapsedS: number,
): number {
  return altFt + ((verticalRateFpm ?? 0) / 60) * elapsedS;
}

/** Distance-to-threshold (NM) reduced by groundspeed (kt) over `elapsedS`. */
export function reckonDistanceNm(distanceNm: number, gsKt: number, elapsedS: number): number {
  return Math.max(0, distanceNm - gsKt * KT_TO_MS * elapsedS * M_TO_NM);
}
