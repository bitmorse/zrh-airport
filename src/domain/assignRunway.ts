import type { Aircraft } from "../data/adsb";
import { angleDelta, projectOntoSegment, toLocalMeters, type Vec2 } from "../lib/geo";
import type { Airport } from "./airport";

// Tuning constants for the corridor around each runway end.
const HALF_WIDTH_M = 1500; // max perpendicular distance from centreline
const APPROACH_M = 28000; // corridor length before the threshold (~15 NM final)
const DEPARTURE_M = 8000; // corridor length past the far end (initial climb)
const TRACK_TOL_DEG = 40; // how closely track must match the runway bearing
const MAX_ALT_FT = 7000; // ignore aircraft crossing above the approach/climb band
const MIN_ACTIVE_GS_KT = 40; // below this an aircraft is taxiing/holding, not using the runway

export type RunwayPhase = "approach" | "runway" | "departure";

export interface RunwayAssignment {
  /** Runway-end id this aircraft is attributed to, e.g. "28". */
  end: string;
  /** Physical strip, e.g. "10/28". */
  strip: string;
  phase: RunwayPhase;
  crossTrackM: number;
  /**
   * Signed distance along the runway axis from this end's threshold: 0 at the
   * threshold, positive toward the far end (on the runway / departing), negative
   * on approach. So the approach distance to touchdown is `-alongTrackM`.
   */
  alongTrackM: number;
}

/**
 * Decide which runway end (if any) an aircraft is using, from its position,
 * track and altitude. Returns null when the aircraft is not plausibly in any
 * runway corridor. This is a heuristic inference from ADS-B, not an official
 * runway assignment.
 */
export function assignRunway(airport: Airport, ac: Aircraft): RunwayAssignment | null {
  if (!ac.onGround && (ac.altFt === null || ac.altFt > MAX_ALT_FT)) return null;
  if (ac.track === null) return null;
  // Exclude taxiing / holding aircraft (e.g. on a parallel taxiway within the
  // corridor) so they don't inflate the runway-usage counts. Landing rollouts and
  // takeoff rolls are well above this.
  if (ac.gs !== null && ac.gs < MIN_ACTIVE_GS_KT) return null;

  const p: Vec2 = toLocalMeters(airport.config.arp, { lat: ac.lat, lon: ac.lon });

  let best: RunwayAssignment | null = null;
  for (const { end, a, b } of airport.endsLocal) {
    if (angleDelta(ac.track, end.bearingDeg) > TRACK_TOL_DEG) continue;

    const { crossTrack, alongTrack, len } = projectOntoSegment(p, a, b);
    if (crossTrack > HALF_WIDTH_M) continue;
    if (alongTrack < -APPROACH_M || alongTrack > len + DEPARTURE_M) continue;

    const phase: RunwayPhase =
      alongTrack < 0 ? "approach" : alongTrack <= len ? "runway" : "departure";

    if (!best || crossTrack < best.crossTrackM) {
      best = {
        end: end.id,
        strip: end.strip,
        phase,
        crossTrackM: crossTrack,
        alongTrackM: alongTrack,
      };
    }
  }
  return best;
}

/** Convenience: altitude above the field in feet, or 0 on the ground. */
export function altAboveFieldFt(
  ac: Pick<Aircraft, "onGround" | "altFt">,
  fieldElevationFt: number,
): number {
  if (ac.onGround || ac.altFt === null) return 0;
  return Math.max(0, ac.altFt - fieldElevationFt);
}
