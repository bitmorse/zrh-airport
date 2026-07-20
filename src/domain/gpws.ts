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

export interface GpwsCue {
  key: string;
  ft: number;
  url: string;
}

// Real GPWS callout recordings (the GeoFS GPWS set). Played cross-origin via an
// <audio> element (no CORS needed for playback); this is the one external fetch in
// the app, only when "play GPWS" is on.
const SND = "https://tylerbmusic.github.io/GPWS-files_geofs/";

/**
 * Approach callout schedule, high → low. "minimums" replaces the 200 ft number at the
 * decision height and "retard" replaces 20 ft (Airbus flare), so nothing overlaps.
 */
export const GPWS_SCHEDULE: GpwsCue[] = [
  { key: "2500", ft: 2500, url: `${SND}2500.wav` },
  { key: "1000", ft: 1000, url: `${SND}1000.wav` },
  { key: "500", ft: 500, url: `${SND}500.wav` },
  { key: "400", ft: 400, url: `${SND}400.wav` },
  { key: "300", ft: 300, url: `${SND}300.wav` },
  { key: "minimums", ft: 200, url: `${SND}minimum.wav` },
  { key: "100", ft: 100, url: `${SND}100.wav` },
  { key: "50", ft: 50, url: `${SND}50.wav` },
  { key: "40", ft: 40, url: `${SND}40.wav` },
  { key: "30", ft: 30, url: `${SND}30.wav` },
  { key: "retard", ft: 20, url: `${SND}retard.wav` },
  { key: "10", ft: 10, url: `${SND}10.wav` },
];

/** How high the aircraft must climb again before a fresh approach re-arms callouts. */
const REARM_FT = 2600;

export interface GpwsState {
  announced: Set<string>;
}

/**
 * Start the engine for an aircraft already at `startAglFt` — pre-mark every cue above
 * the current height as announced, so enabling mid-approach doesn't replay the higher
 * callouts retroactively.
 */
export function createGpwsState(startAglFt: number): GpwsState {
  const announced = new Set<string>();
  for (const c of GPWS_SCHEDULE) if (c.ft > startAglFt) announced.add(c.key);
  return { announced };
}

export interface GpwsInput {
  aglFt: number;
  descending: boolean;
  onGround: boolean;
}

/**
 * Latching callout engine. Fires each not-yet-announced cue once, at/below its height,
 * only while descending and airborne — so ground-level altitude noise can't repeat a
 * callout and a departure/climb never triggers one. Re-arms after a climb back above
 * `REARM_FT` (a go-around → fresh approach). Mutates `state`.
 */
export function gpwsAdvance(state: GpwsState, input: GpwsInput): GpwsCue[] {
  if (input.aglFt > REARM_FT) {
    state.announced.clear();
    return [];
  }
  if (input.onGround || !input.descending) return [];
  const cues: GpwsCue[] = [];
  for (const c of GPWS_SCHEDULE) {
    if (input.aglFt <= c.ft && !state.announced.has(c.key)) {
      state.announced.add(c.key);
      cues.push(c);
    }
  }
  return cues;
}
