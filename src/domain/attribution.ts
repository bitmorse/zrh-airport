/**
 * Attribute a noise recording to the aircraft that made it — by proximity, not by a
 * single heuristic guess. Given the clip window, the observer's GPS track and every
 * live aircraft's position trail, we rank all aircraft that came within a capture
 * radius by their **closest approach** (slant range) and expose the whole set as
 * candidates. The nearest is the auto-chosen primary; the user can re-label to any
 * other. Pure and deterministic so it's unit-testable and reusable for the live
 * "who's nearest right now" readout.
 */
import type { TrailPoint } from "../data/watchStore";
import type { NoiseCandidate, NoiseObserverPoint } from "../data/noiseStore";
import { haversineMeters, type LatLon } from "../lib/geo";

/** Aircraft realistically audible on the ground sit within a few km slant range. */
export const CAPTURE_RADIUS_M = 5000;
const FT_TO_M = 0.3048;
/** Tolerance around the window so a sample just outside a short clip still counts. */
const WINDOW_TOL_MS = 2000;

/** Live identity + position history for one aircraft, at attribution time. */
export interface AttributionAircraft {
  hex: string;
  callsign: string | null;
  aircraftType: string | null;
  aircraftTypeDesc: string | null;
  registration: string | null;
  gsKt: number | null;
  altFt: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  trail: TrailPoint[]; // oldest → newest (trailFor(hex))
}

export interface AttributionInput {
  window: { start: number; end: number }; // epoch ms
  observer: NoiseObserverPoint[]; // GPS series over the clip (may be sparse / single)
  fieldElevationFt: number;
  aircraft: AttributionAircraft[];
  captureRadiusM?: number;
}

export interface AttributionResult {
  /** Candidates within the capture radius, sorted ascending by closest approach. */
  candidates: NoiseCandidate[];
  /** The nearest candidate's hex, or null when nothing was in range. */
  primaryHex: string | null;
}

/** The observer's position at time `t`: linearly interpolated between fixes, clamped. */
function observerAt(observer: NoiseObserverPoint[], t: number): LatLon | null {
  if (observer.length === 0) return null;
  if (observer.length === 1 || t <= observer[0].t) return observer[0];
  const last = observer[observer.length - 1];
  if (t >= last.t) return last;
  for (let i = 1; i < observer.length; i++) {
    const b = observer[i];
    if (t <= b.t) {
      const a = observer[i - 1];
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 0;
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return last;
}

/** Slant range (m) from an observer to an aircraft point, using height above field. */
function slantRangeM(obs: LatLon, pt: TrailPoint, fieldElevationFt: number): number {
  const horizontal = haversineMeters(obs, pt);
  const aglFt = Math.max(0, (pt.alt ?? 0) - fieldElevationFt);
  return Math.hypot(horizontal, aglFt * FT_TO_M);
}

export function attributeCandidates(input: AttributionInput): AttributionResult {
  const { window, observer, fieldElevationFt, aircraft } = input;
  const radius = input.captureRadiusM ?? CAPTURE_RADIUS_M;
  const lo = window.start - WINDOW_TOL_MS;
  const hi = window.end + WINDOW_TOL_MS;

  const candidates: NoiseCandidate[] = [];
  for (const a of aircraft) {
    const track: NoiseCandidate["track"] = [];
    let closestApproachM = Infinity;
    let closestPt: TrailPoint | null = null;
    for (const pt of a.trail) {
      if (pt.t < lo || pt.t > hi) continue;
      const obs = observerAt(observer, pt.t);
      if (!obs) continue;
      const distanceM = slantRangeM(obs, pt, fieldElevationFt);
      track.push({ t: pt.t, lat: pt.lat, lon: pt.lon, alt: pt.alt, distanceM });
      if (distanceM < closestApproachM) {
        closestApproachM = distanceM;
        closestPt = pt;
      }
    }
    if (!closestPt || closestApproachM > radius) continue;
    candidates.push({
      hex: a.hex,
      callsign: a.callsign,
      aircraftType: a.aircraftType,
      aircraftTypeDesc: a.aircraftTypeDesc,
      registration: a.registration,
      closestApproachM,
      track,
      closest: {
        t: closestPt.t,
        gsKt: a.gsKt,
        altFt: a.altFt,
        trackDeg: a.trackDeg,
        verticalRateFpm: a.verticalRateFpm,
        acLat: closestPt.lat,
        acLon: closestPt.lon,
      },
    });
  }

  candidates.sort((x, y) => x.closestApproachM - y.closestApproachM);
  return { candidates, primaryHex: candidates[0]?.hex ?? null };
}
