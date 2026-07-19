import type { Aircraft } from "../data/adsb";
import {
  angleDelta,
  projectOntoSegment,
  toLocalMeters,
  type Vec2,
} from "../lib/geo";
import type { Airport, RunwayEnd } from "./airport";

/**
 * Departure detection from ADS-B, phase by phase:
 *   holding — on the ground at/near a threshold, ~stationary (departure imminent)
 *   roll    — on the ground, aligned, accelerating (≈ just after "cleared for
 *             takeoff"; the closest observable proxy — ADS-B carries no clearance)
 *   climb   — airborne past the threshold, climbing out
 *
 * "roll" requires the groundspeed to be *increasing* vs the previous poll, which
 * distinguishes a takeoff roll from a landing roll-out (decelerating). Ground
 * coverage from community receivers is imperfect, so some surface movement may be
 * missing.
 */

export type DeparturePhase = "holding" | "roll" | "climb";

export interface DepartureEvent {
  end: string;
  strip: string;
  hex: string;
  callsign: string;
  phase: DeparturePhase;
  gsKt: number | null;
  /** For "holding": epoch ms when the aircraft started waiting at the threshold. */
  holdingSinceMs?: number;
  /** For "roll": how long it waited before the roll began (≈ clearance). */
  waitedMs?: number;
}

const HALF_WIDTH_M = 220; // lateral tolerance around the runway centreline (ground)
const BEFORE_M = 300; // just short of the threshold
const HOLD_AFTER_M = 500; // just onto the runway
const CLIMB_AFTER_M = 8000; // initial climb past the far end
const TRACK_TOL_DEG = 45;
const HOLD_GS = 12; // ~stationary
const ROLL_MIN_GS = 25;
const ROLL_MAX_GS = 175;
const ACCEL_MIN_KT = 3; // gs increase between polls to count as accelerating
const CLIMB_MIN_FPM = 200;
const MAX_ALT_FT = 6000;

const label = (ac: Aircraft) => ac.flight ?? ac.hex.toUpperCase();

/**
 * Track how long each aircraft has been holding at a threshold and when its roll
 * begins. Mutates `holdingSince` (a persistent map across polls): records the
 * start time on the first "holding" poll, and on "roll" reports the waited
 * duration and clears it. Also prunes aircraft that have left the feed.
 */
export function trackHolding(
  departures: DepartureEvent[],
  presentHexes: Set<string>,
  holdingSince: Map<string, number>,
  nowMs: number,
): DepartureEvent[] {
  for (const d of departures) {
    if (d.phase === "holding") {
      if (!holdingSince.has(d.hex)) holdingSince.set(d.hex, nowMs);
      d.holdingSinceMs = holdingSince.get(d.hex);
    } else if (d.phase === "roll") {
      const since = holdingSince.get(d.hex);
      if (since != null) {
        d.waitedMs = nowMs - since;
        holdingSince.delete(d.hex);
      }
    }
  }
  for (const hex of [...holdingSince.keys()]) {
    if (!presentHexes.has(hex)) holdingSince.delete(hex);
  }
  return departures;
}

/** Snapshot of each aircraft's groundspeed, to compare against next poll. */
export function gsSnapshot(aircraft: Aircraft[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of aircraft) if (a.gs != null) m.set(a.hex, a.gs);
  return m;
}

export function detectDepartures(
  airport: Airport,
  aircraft: Aircraft[],
  prevGs: Map<string, number>,
): DepartureEvent[] {
  const out: DepartureEvent[] = [];
  for (const ac of aircraft) {
    const p: Vec2 = toLocalMeters(airport.config.arp, { lat: ac.lat, lon: ac.lon });
    let best: { end: RunwayEnd; phase: DeparturePhase; cross: number } | null = null;

    for (const { end, a, b } of airport.endsLocal) {
      const { crossTrack, alongTrack, len } = projectOntoSegment(p, a, b);
      if (crossTrack > HALF_WIDTH_M) continue;

      let phase: DeparturePhase | null = null;
      if (ac.onGround) {
        if (
          ac.gs != null &&
          ac.gs <= HOLD_GS &&
          alongTrack >= -BEFORE_M &&
          alongTrack <= HOLD_AFTER_M
        ) {
          phase = "holding";
        } else if (
          ac.gs != null &&
          ac.gs >= ROLL_MIN_GS &&
          ac.gs <= ROLL_MAX_GS &&
          ac.track != null &&
          angleDelta(ac.track, end.bearingDeg) <= TRACK_TOL_DEG &&
          alongTrack >= -BEFORE_M &&
          alongTrack <= len
        ) {
          const prev = prevGs.get(ac.hex);
          if (prev != null && ac.gs - prev >= ACCEL_MIN_KT) phase = "roll";
        }
      } else if (
        ac.altFt != null &&
        ac.altFt <= MAX_ALT_FT &&
        ac.track != null &&
        angleDelta(ac.track, end.bearingDeg) <= TRACK_TOL_DEG &&
        alongTrack >= -BEFORE_M &&
        alongTrack <= len + CLIMB_AFTER_M &&
        ac.verticalRateFpm != null &&
        ac.verticalRateFpm >= CLIMB_MIN_FPM
      ) {
        phase = "climb";
      }

      if (phase && (!best || crossTrack < best.cross)) {
        best = { end, phase, cross: crossTrack };
      }
    }

    if (best) {
      out.push({
        end: best.end.id,
        strip: best.end.strip,
        hex: ac.hex,
        callsign: label(ac),
        phase: best.phase,
        gsKt: ac.gs,
      });
    }
  }
  return out;
}
