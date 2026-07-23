import type { Aircraft } from "../data/adsb";
import type { Airport } from "../data/flightInfo";
import { haversineMeters } from "./geo";

/**
 * Live "when does it get there" helpers shared by the flight cards: a great-circle ETA
 * to the destination from current position + groundspeed, and small time formatters.
 * We have no scheduled times (ADS-B carries none), so this is the honest live estimate.
 */

const M_TO_NM = 1 / 1852;

/** "1h 12m" / "12m" / "<1m" from seconds. */
export function humanDuration(sec: number): string {
  if (sec < 60) return "<1m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Local wall-clock HH:MM (viewer's timezone). */
export function localHhmm(ms: number): string {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(ms),
  );
}

export interface Eta {
  etaSec: number;
  arriveAtMs: number;
  remainingNm: number;
}

/**
 * ETA to `dest` from the aircraft's current position at its groundspeed, or null when it
 * can't be estimated (on the ground, near-stationary, or no destination coordinates).
 */
export function etaToDestination(
  ac: Pick<Aircraft, "lat" | "lon" | "gs" | "onGround"> | null | undefined,
  dest: Pick<Airport, "lat" | "lon"> | null | undefined,
  nowMs: number,
): Eta | null {
  if (!ac || ac.onGround || (ac.gs ?? 0) <= 40 || dest?.lat == null || dest.lon == null) return null;
  const remainingNm =
    haversineMeters({ lat: ac.lat, lon: ac.lon }, { lat: dest.lat, lon: dest.lon }) * M_TO_NM;
  const etaSec = (remainingNm / (ac.gs as number)) * 3600;
  return { etaSec, arriveAtMs: nowMs + etaSec * 1000, remainingNm };
}
