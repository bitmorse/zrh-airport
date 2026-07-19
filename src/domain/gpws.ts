import type { Aircraft } from "../data/adsb";

/**
 * A toy GPWS / auto-callout engine: the spoken height callouts you hear on an
 * airliner's approach ("five hundred", "one hundred", "minimums", "retard"…).
 * Height above the runway is taken from the aircraft's geometric (GNSS) altitude
 * when broadcast — accurate and self-contained — falling back to barometric.
 */

/** Height above field, feet — prefers GNSS (geom) altitude, falls back to baro. */
export function heightAglFt(
  ac: Pick<Aircraft, "altGeomFt" | "altFt" | "onGround">,
  fieldElevationFt: number,
  geoidFt = 0,
): number {
  if (ac.onGround) return 0;
  if (ac.altGeomFt != null) return ac.altGeomFt - fieldElevationFt - geoidFt;
  if (ac.altFt != null) return ac.altFt - fieldElevationFt;
  return 0;
}

export interface Callout {
  ft: number;
  say: string;
}

/** Standard radio-altimeter auto-callouts, high → low. */
export const CALLOUTS: Callout[] = [
  { ft: 2500, say: "twenty five hundred" },
  { ft: 1000, say: "one thousand" },
  { ft: 500, say: "five hundred" },
  { ft: 400, say: "four hundred" },
  { ft: 300, say: "three hundred" },
  { ft: 200, say: "two hundred" },
  { ft: 100, say: "one hundred" },
  { ft: 50, say: "fifty" },
  { ft: 40, say: "forty" },
  { ft: 30, say: "thirty" },
  { ft: 20, say: "twenty" },
  { ft: 10, say: "ten" },
];

/**
 * The callouts crossed while descending from `prevFt` to `curFt`, high → low. A
 * callout fires when the height passes down through it (`curFt <= ft < prevFt`), so
 * each fires exactly once and none are skipped between samples. Empty when level or
 * climbing.
 */
export function nextCallouts(prevFt: number, curFt: number): Callout[] {
  if (curFt >= prevFt) return [];
  return CALLOUTS.filter((c) => c.ft < prevFt && c.ft >= curFt);
}
