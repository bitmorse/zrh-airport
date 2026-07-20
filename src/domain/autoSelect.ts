/**
 * Auto-select: when the user hasn't picked a flight themselves, choose the most
 * "interesting" one to track — where something is about to happen — and switch away
 * once it's done. Pure helpers; the orchestration/timers live in App.
 */
import type { Aircraft } from "../data/adsb";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import type { DepartureEvent } from "./departures";
import { heightAglFt } from "./gpws";
import type { Arrival } from "./predictions";

/** Only auto-select after the user has left the selection empty this long. */
export const AUTO_IDLE_MS = 60_000;

const STABILIZED_AGL_FT = 1000; // at/below the stabilise gate ⇒ short final / landing
const FINAL_MAX_ETA_S = 300; // "on final" cutoff (~5 min); further out isn't imminent
const STOP_KT = 10; // rolled out to a near-stop

/**
 * The most interesting flight to track, by priority:
 *   0 stabilized / short final / rolling out (arrival at/below 1000 ft AGL),
 *   1 on final (arrival within ~5 min),
 *   2 cleared for takeoff / rolling (departure "roll"),
 *   3 climbing out (departure "climb").
 * Ties break toward the nearest event (soonest arrival, lowest climb). Returns the
 * hex, or null when nothing is imminent.
 */
export function pickInteresting(
  arrivals: Arrival[],
  departures: DepartureEvent[],
  aircraft: AircraftWithAssignment[],
  fieldElevationFt: number,
  geoidFt: number,
): string | null {
  const acByHex = new Map(aircraft.map((w) => [w.ac.hex, w.ac]));
  const state: { best: { hex: string; tier: number; key: number } | null } = { best: null };
  const consider = (hex: string, tier: number, key: number) => {
    const b = state.best;
    if (!b || tier < b.tier || (tier === b.tier && key < b.key)) {
      state.best = { hex, tier, key };
    }
  };

  for (const a of arrivals) {
    const ac = acByHex.get(a.hex);
    if (!ac) continue;
    const agl = ac.onGround ? 0 : heightAglFt(ac, fieldElevationFt, geoidFt);
    if (agl <= STABILIZED_AGL_FT) consider(a.hex, 0, a.etaSeconds);
    else if (a.etaSeconds <= FINAL_MAX_ETA_S) consider(a.hex, 1, a.etaSeconds);
  }
  for (const d of departures) {
    if (d.phase === "roll") consider(d.hex, 2, 0);
    else if (d.phase === "climb") consider(d.hex, 3, acByHex.get(d.hex)?.altFt ?? 0);
  }
  return state.best?.hex ?? null;
}

/**
 * Should the auto-tracker drop its current target and pick the next one? True once
 * the aircraft has left the feed, landed and come to a near-stop, or — while
 * climbing out — moved out of the visible map. (Out-of-view only counts for a
 * climbing aircraft, so an arrival the user merely panned away from isn't dropped.)
 */
export function shouldRelease(
  ac: Pick<Aircraft, "onGround" | "gs"> | undefined,
  visible: boolean,
  climbing: boolean,
): boolean {
  if (!ac) return true; // disappeared from the feed
  if (ac.onGround && (ac.gs ?? 0) < STOP_KT) return true; // landed & stopped
  if (!ac.onGround && climbing && !visible) return true; // climbed out of the viewport
  return false;
}
