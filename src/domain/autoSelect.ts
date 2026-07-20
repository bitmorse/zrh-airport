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

const FULL_COUNTDOWN_AGL_FT = 1000; // still at/above the stabilise gate ⇒ full GPWS run ahead
const FINAL_MAX_ETA_S = 300; // "on final" cutoff (~5 min); further out isn't imminent
const STOP_KT = 10; // rolled out to a near-stop

/**
 * The most interesting flight to track, by priority:
 *   0 arrival on final still at/above the 1000 ft stabilise gate — the whole GPWS
 *     countdown is still ahead, so the auto-tracked landing plays out fully,
 *   1 arrival on short final (airborne, below 1000 ft — partial countdown left),
 *   2 cleared for takeoff / rolling (departure "roll"),
 *   3 climbing out (departure "climb"),
 *   4 arrival rolling out on the ground (just landed).
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
    if (a.etaSeconds > FINAL_MAX_ETA_S) continue; // distant inbound — not imminent
    const ac = acByHex.get(a.hex);
    if (!ac) continue;
    const agl = heightAglFt(ac, fieldElevationFt, geoidFt);
    // Bias toward a plane still high enough that the full countdown is ahead, rather
    // than grabbing the one already at touchdown (little GPWS left to hear).
    const tier = ac.onGround ? 4 : agl >= FULL_COUNTDOWN_AGL_FT ? 0 : 1;
    consider(a.hex, tier, a.etaSeconds);
  }
  for (const d of departures) {
    if (d.phase === "roll") consider(d.hex, 2, 0);
    else if (d.phase === "climb") consider(d.hex, 3, acByHex.get(d.hex)?.altFt ?? 0);
  }
  return state.best?.hex ?? null;
}

/** A climbing departure this far above the field has left the interesting near-field phase. */
export const RELEASE_AGL_FT = 3000;

/**
 * Should the auto-tracker drop its current target and pick the next one? True once
 * the aircraft has left the feed, landed and come to a near-stop, or — while climbing
 * out — climbed clear of the near-field phase (`climbedOut`). Release is decoupled from
 * the viewport, so following the target doesn't cause it to be dropped and re-picked.
 */
export function shouldRelease(
  ac: Pick<Aircraft, "onGround" | "gs"> | undefined,
  climbedOut: boolean,
): boolean {
  if (!ac) return true; // disappeared from the feed
  if (ac.onGround && (ac.gs ?? 0) < STOP_KT) return true; // landed & stopped
  if (!ac.onGround && climbedOut) return true; // climbed clear of the field
  return false;
}
