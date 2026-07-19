import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { heightAglFt } from "./gpws";

const KT_TO_MS = 0.514444;
const M_TO_NM = 1 / 1852;

const MIN_GS_KT = 40; // below this an "arrival" is more likely taxi / bad data
const MAX_ETA_S = 12 * 60; // ignore very distant / implausible estimates
// A landing aircraft descends or holds level; a climbing one is going around or
// overflying, not landing.
const ARRIVAL_MAX_CLIMB_FPM = 300;

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
  /** The approach gate this aircraft most recently crossed (for a brief flash). */
  flash?: { label: string; atMs: number };
}

/** CAT I ILS decision height — ~200 ft above the touchdown zone. */
export const DECISION_HEIGHT_FT = 200;

export interface ApproachGate {
  ft: number;
  label: string;
}

/**
 * Approach gates a landing aircraft passes, high → low: the stabilised-approach gate
 * (1000 ft AGL — must be on speed/path/configured or go around) and decision height
 * (~200 ft — land or go around). Heights are AGL, estimated from GNSS altitude.
 */
export const APPROACH_GATES: ApproachGate[] = [
  { ft: 1000, label: "stabilise" },
  { ft: DECISION_HEIGHT_FT, label: "decision height" },
];

/** hex → (gate height → epoch ms first crossed). */
export type GateCrossings = Map<string, Map<number, number>>;

/**
 * Record when a landing aircraft first descends through each approach gate, so the
 * UI can briefly flash it. AGL from GNSS altitude (approximate). Mutates `crossings`
 * (persistent across polls); prunes aircraft once they leave the feed.
 */
export function trackApproachGates(
  items: AircraftWithAssignment[],
  crossings: GateCrossings,
  fieldElevationFt: number,
  geoidFt: number,
  nowMs: number,
  gates: ApproachGate[] = APPROACH_GATES,
): void {
  const present = new Set<string>();
  for (const w of items) {
    present.add(w.ac.hex);
    if (!w.assignment || w.assignment.phase !== "approach") continue;
    if (w.ac.onGround) continue;
    const aglFt = heightAglFt(w.ac, fieldElevationFt, geoidFt);
    if (aglFt <= 0) continue;
    let byGate = crossings.get(w.ac.hex);
    for (const g of gates) {
      if (aglFt <= g.ft) {
        if (!byGate) crossings.set(w.ac.hex, (byGate = new Map()));
        if (!byGate.has(g.ft)) byGate.set(g.ft, nowMs);
      }
    }
  }
  for (const hex of [...crossings.keys()]) if (!present.has(hex)) crossings.delete(hex);
}

/** The most recently crossed gate for `hex`, if within `windowMs`. */
export function recentGate(
  crossings: GateCrossings,
  hex: string,
  nowMs: number,
  windowMs: number,
  gates: ApproachGate[] = APPROACH_GATES,
): { label: string; atMs: number } | undefined {
  const byGate = crossings.get(hex);
  if (!byGate) return undefined;
  let best: { label: string; atMs: number } | undefined;
  // gates are high → low, so `>=` makes the lower (more advanced) gate win ties.
  for (const g of gates) {
    const t = byGate.get(g.ft);
    if (t != null && nowMs - t <= windowMs && (!best || t >= best.atMs)) {
      best = { label: g.label, atMs: t };
    }
  }
  return best;
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
      strip: a.strip,
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

/** Keep the "landing" label until the aircraft has slowed on the runway to this. */
export const LANDING_ROLLOUT_MIN_KT = 54; // ≈ 100 km/h

interface LandingMemory {
  arr: Arrival;
  lastSeen: number;
}

/**
 * `predictArrivals` drops an aircraft the instant it crosses the threshold, but it's
 * still landing — decelerating down the runway. Keep it in the list (as a landing,
 * `etaSeconds: 0`) through the rollout until it slows below ~100 km/h, then drop it.
 * A go-around (climbing away) also drops it. Mirrors `trackDepartures`; `memory`
 * persists across polls.
 */
export function trackLandings(
  freshArrivals: Arrival[],
  items: AircraftWithAssignment[],
  memory: Map<string, LandingMemory>,
  nowMs: number,
  lingerMs = 20000,
): Arrival[] {
  const itemByHex = new Map(items.map((w) => [w.ac.hex, w]));
  const freshHexes = new Set(freshArrivals.map((a) => a.hex));
  for (const a of freshArrivals) memory.set(a.hex, { arr: a, lastSeen: nowMs });

  const out = [...freshArrivals];
  for (const [hex, m] of [...memory]) {
    if (freshHexes.has(hex)) continue; // already emitted as a fresh (on-approach) arrival
    const w = itemByHex.get(hex);

    if (w) {
      const { ac, assignment } = w;
      const goingAround =
        !ac.onGround &&
        ac.verticalRateFpm != null &&
        ac.verticalRateFpm > ARRIVAL_MAX_CLIMB_FPM;
      const rollingOut =
        ac.gs != null &&
        ac.gs >= LANDING_ROLLOUT_MIN_KT &&
        (ac.onGround || assignment?.phase === "runway");
      if (goingAround || !rollingOut) {
        memory.delete(hex); // slowed to a taxi, or went around — done landing
        continue;
      }
      const landing: Arrival = {
        ...m.arr,
        end: assignment?.end ?? m.arr.end,
        strip: assignment?.strip ?? m.arr.strip,
        etaSeconds: 0,
        distanceNm: 0,
        gsKt: ac.gs ?? m.arr.gsKt,
      };
      memory.set(hex, { arr: landing, lastSeen: nowMs });
      out.push(landing);
    } else if (nowMs - m.lastSeen <= lingerMs) {
      out.push({ ...m.arr, etaSeconds: 0, distanceNm: 0 }); // briefly off the feed
    } else {
      memory.delete(hex);
    }
  }
  return out.sort((x, y) => x.etaSeconds - y.etaSeconds);
}
