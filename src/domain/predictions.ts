import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { RUNWAY_END_BY_ID } from "./runways";

const KT_TO_MS = 0.514444;
const M_TO_NM = 1 / 1852;

const MIN_GS_KT = 40; // below this an "arrival" is more likely taxi / bad data
const MAX_ETA_S = 12 * 60; // ignore very distant / implausible estimates
// Vertical-rate gates (ft/min). A landing aircraft descends or holds level; a
// climbing one is going around or overflying, not landing. A departure climbs.
const ARRIVAL_MAX_CLIMB_FPM = 300;
const DEPARTURE_MIN_CLIMB_FPM = 300;

export interface Arrival {
  /** Runway end being landed on, e.g. "28". */
  end: string;
  /** Physical strip, e.g. "10/28". */
  strip: string;
  hex: string;
  callsign: string;
  etaSeconds: number;
  distanceNm: number;
  gsKt: number;
}

export interface Departure {
  end: string;
  strip: string;
  hex: string;
  callsign: string;
}

function label(w: AircraftWithAssignment): string {
  return w.ac.flight ?? w.ac.hex.toUpperCase();
}

/**
 * Is this aircraft plausibly landing? Must be airborne, on the approach side of a
 * runway, moving fast enough to be flying, and not climbing (a climb means a
 * go-around or an overflight, not a landing).
 */
function isArriving(w: AircraftWithAssignment): boolean {
  const { ac, assignment } = w;
  if (!assignment || assignment.phase !== "approach") return false;
  if (ac.onGround) return false; // on final ⇒ airborne
  if (ac.gs === null || ac.gs < MIN_GS_KT) return false;
  if (assignment.alongTrackM >= 0) return false; // must be before the threshold
  // Asymmetry vs. isDeparting is deliberate: on the approach side, being low and
  // fast already implies a landing, so a missing vertical rate is treated as
  // "not climbing" and kept; only a clear climb (go-around) rules it out.
  if (ac.verticalRateFpm !== null && ac.verticalRateFpm > ARRIVAL_MAX_CLIMB_FPM)
    return false;
  return true;
}

/**
 * Estimate a landing ETA for every aircraft on final approach:
 * ETA ≈ distance-to-threshold ÷ groundspeed. Aircraft decelerate on short final,
 * so the real touchdown is a little later — this is a live estimate, re-run each
 * poll, not a schedule. Sorted soonest-first.
 */
export function predictArrivals(items: AircraftWithAssignment[]): Arrival[] {
  const out: Arrival[] = [];
  for (const w of items) {
    if (!isArriving(w)) continue;
    const a = w.assignment!;
    const gs = w.ac.gs!;

    const distanceM = -a.alongTrackM; // approach ⇒ alongTrack < 0
    if (distanceM <= 0) continue;
    const etaSeconds = distanceM / (gs * KT_TO_MS);
    if (etaSeconds > MAX_ETA_S) continue;

    out.push({
      end: a.end,
      strip: RUNWAY_END_BY_ID[a.end]?.strip ?? a.end,
      hex: w.ac.hex,
      callsign: label(w),
      etaSeconds,
      distanceNm: distanceM * M_TO_NM,
      gsKt: gs,
    });
  }
  return out.sort((x, y) => x.etaSeconds - y.etaSeconds);
}

/** Soonest arrival per physical strip (best of the strip's two ends). */
export function nextArrivalByStrip(
  items: AircraftWithAssignment[],
): Record<string, Arrival> {
  const byStrip: Record<string, Arrival> = {};
  for (const arr of predictArrivals(items)) {
    // predictArrivals is sorted soonest-first, so the first seen per strip wins.
    if (!byStrip[arr.strip]) byStrip[arr.strip] = arr;
  }
  return byStrip;
}

/**
 * Is this aircraft climbing out off a runway? Airborne, past the threshold (not on
 * the approach side), and climbing. We require a confirmed climb rather than
 * relying on position alone, so a just-landed aircraft rolling out isn't
 * mislabelled as departing. Timing can't be predicted ahead — this is "now".
 */
function isDeparting(w: AircraftWithAssignment): boolean {
  const { ac, assignment } = w;
  if (!assignment || ac.onGround) return false;
  if (assignment.phase === "approach") return false; // approach side ⇒ not departing
  // Require a confirmed climb: without it we can't distinguish a departure from a
  // just-landed aircraft rolling out past the far threshold, so a missing vertical
  // rate excludes it (conservative — no false departures).
  return (
    ac.verticalRateFpm !== null && ac.verticalRateFpm >= DEPARTURE_MIN_CLIMB_FPM
  );
}

/** Aircraft currently climbing out off a runway (live, no countdown). */
export function departingNow(items: AircraftWithAssignment[]): Departure[] {
  const out: Departure[] = [];
  for (const w of items) {
    if (!isDeparting(w)) continue;
    const a = w.assignment!;
    out.push({
      end: a.end,
      strip: RUNWAY_END_BY_ID[a.end]?.strip ?? a.end,
      hex: w.ac.hex,
      callsign: label(w),
    });
  }
  return out;
}
