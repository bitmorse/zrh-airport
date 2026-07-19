/**
 * Dead reckoning: extrapolate an aircraft's motion values between ADS-B polls (a
 * few seconds apart) from its rates, so displayed numbers tick smoothly and look
 * live instead of jumping each poll. On the next poll they snap back to the truth.
 * The map already dead-reckons position the same way.
 */

const KT_TO_MS = 0.514444;
const M_TO_NM = 1 / 1852;

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
