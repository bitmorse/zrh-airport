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
  url: string;
}

// Real GPWS callout recordings (the GeoFS GPWS set). Played cross-origin via an
// <audio> element (no CORS needed for playback); this is the one external fetch in
// the app, only when "play GPWS" is on.
const SND = "https://tylerbmusic.github.io/GPWS-files_geofs/";

/** Standard radio-altimeter auto-callouts, high → low. */
export const CALLOUTS: Callout[] = [
  { ft: 2500, url: `${SND}2500.wav` },
  { ft: 1000, url: `${SND}1000.wav` },
  { ft: 500, url: `${SND}500.wav` },
  { ft: 400, url: `${SND}400.wav` },
  { ft: 300, url: `${SND}300.wav` },
  { ft: 200, url: `${SND}200.wav` },
  { ft: 100, url: `${SND}100.wav` },
  { ft: 50, url: `${SND}50.wav` },
  { ft: 40, url: `${SND}40.wav` },
  { ft: 30, url: `${SND}30.wav` },
  { ft: 20, url: `${SND}20.wav` },
  { ft: 10, url: `${SND}10.wav` },
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
