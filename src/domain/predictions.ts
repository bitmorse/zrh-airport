import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { RUNWAY_END_BY_ID } from "./runways";

const KT_TO_MS = 0.514444;
const M_TO_NM = 1 / 1852;

const MIN_GS_KT = 30; // below this we can't meaningfully estimate an arrival
const MAX_ETA_S = 12 * 60; // ignore very distant / implausible estimates

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
 * Estimate a landing ETA for every aircraft on final approach:
 * ETA ≈ distance-to-threshold ÷ groundspeed. Aircraft decelerate on short final,
 * so the real touchdown is a little later — this is a live estimate, re-run each
 * poll, not a schedule. Sorted soonest-first.
 */
export function predictArrivals(items: AircraftWithAssignment[]): Arrival[] {
  const out: Arrival[] = [];
  for (const w of items) {
    const a = w.assignment;
    if (!a || a.phase !== "approach") continue;
    const gs = w.ac.gs;
    if (gs === null || gs < MIN_GS_KT) continue;

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
 * Aircraft currently taking off — rolling on the runway or climbing out. Their
 * timing can't be predicted ahead, so this is a live "now" list, not a countdown.
 */
export function departingNow(items: AircraftWithAssignment[]): Departure[] {
  const out: Departure[] = [];
  for (const w of items) {
    const a = w.assignment;
    if (!a || a.phase !== "departure") continue;
    out.push({
      end: a.end,
      strip: RUNWAY_END_BY_ID[a.end]?.strip ?? a.end,
      hex: w.ac.hex,
      callsign: label(w),
    });
  }
  return out;
}
