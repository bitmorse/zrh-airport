import type { Aircraft } from "../data/adsb";
import {
  angleDelta,
  projectOntoSegment,
  toLocalMeters,
  type Vec2,
} from "../lib/geo";
import { RUNWAY_ENDS, ZRH_ARP } from "./runways";

// Tuning constants for the corridor around each runway end.
const HALF_WIDTH_M = 1500; // max perpendicular distance from centreline
const APPROACH_M = 9000; // corridor length before the threshold (~5 NM final)
const DEPARTURE_M = 6000; // corridor length past the far end (initial climb)
const TRACK_TOL_DEG = 40; // how closely track must match the runway bearing
const MAX_ALT_FT = 6000; // ignore aircraft crossing above the approach/climb band
const MIN_ACTIVE_GS_KT = 40; // below this an aircraft is taxiing/holding, not using the runway
const ZRH_FIELD_ELEV_FT = 1416;

export type RunwayPhase = "approach" | "runway" | "departure";

export interface RunwayAssignment {
  /** Runway-end id this aircraft is attributed to, e.g. "28". */
  end: string;
  phase: RunwayPhase;
  crossTrackM: number;
  /**
   * Signed distance along the runway axis from this end's threshold: 0 at the
   * threshold, positive toward the far end (on the runway / departing), negative
   * on approach. So the approach distance to touchdown is `-alongTrackM`.
   */
  alongTrackM: number;
}

// Pre-compute each runway end's centreline in local metres (once).
const ENDS_LOCAL = RUNWAY_ENDS.map((e) => ({
  end: e,
  a: toLocalMeters(ZRH_ARP, e.threshold),
  b: toLocalMeters(ZRH_ARP, e.farEnd),
}));

/**
 * Decide which runway end (if any) an aircraft is using, from its position,
 * track and altitude. Returns null when the aircraft is not plausibly in any
 * runway corridor. This is a heuristic inference from ADS-B, not an official
 * runway assignment.
 */
export function assignRunway(ac: Aircraft): RunwayAssignment | null {
  if (!ac.onGround && (ac.altFt === null || ac.altFt > MAX_ALT_FT)) return null;
  if (ac.track === null) return null;
  // Exclude taxiing / holding aircraft (e.g. on a parallel taxiway within the
  // corridor) so they don't inflate the runway-usage counts. Landing rollouts and
  // takeoff rolls are well above this.
  if (ac.gs !== null && ac.gs < MIN_ACTIVE_GS_KT) return null;

  const p: Vec2 = toLocalMeters(ZRH_ARP, { lat: ac.lat, lon: ac.lon });

  let best: RunwayAssignment | null = null;
  for (const { end, a, b } of ENDS_LOCAL) {
    if (angleDelta(ac.track, end.bearingDeg) > TRACK_TOL_DEG) continue;

    const { crossTrack, alongTrack, len } = projectOntoSegment(p, a, b);
    if (crossTrack > HALF_WIDTH_M) continue;
    if (alongTrack < -APPROACH_M || alongTrack > len + DEPARTURE_M) continue;

    const phase: RunwayPhase =
      alongTrack < 0 ? "approach" : alongTrack <= len ? "runway" : "departure";

    if (!best || crossTrack < best.crossTrackM) {
      best = { end: end.id, phase, crossTrackM: crossTrack, alongTrackM: alongTrack };
    }
  }
  return best;
}

/** Convenience: altitude above the field in feet, or 0 on the ground. */
export function altAboveFieldFt(ac: Aircraft): number {
  if (ac.onGround || ac.altFt === null) return 0;
  return Math.max(0, ac.altFt - ZRH_FIELD_ELEV_FT);
}
