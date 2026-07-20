import type { Aircraft } from "../data/adsb";
import type { RunwayAssignment } from "./assignRunway";
import type { DepartureEvent } from "./departures";
import type { Arrival } from "./predictions";

export interface FlightStatus {
  /** A human phrase for the aircraft's current phase, or null when there's nothing
   *  meaningful to say (an airborne aircraft with no relation to this field). */
  label: string | null;
  /** The runway end the phase relates to, when known (e.g. "28"). */
  rwy?: string;
}

/**
 * A meaningful phase phrase for a (usually selected) aircraft, derived from the richest
 * signal available — its live departure or arrival record first (both carry linger
 * memory, so a just-landed plane keeps reading "just landed" through its rollout), then
 * the runway assignment, then its ground state. Deliberately avoids the old
 * "in range" / "tracking" fallbacks: an airborne aircraft with no field relation returns
 * `label: null` so the caller shows motion only, and a slow aircraft on the ground reads
 * "taxiing" / "on the ground" rather than a vague word.
 */
export function flightStatusLabel({
  ac,
  assignment,
  arrival,
  departure,
}: {
  ac: Pick<Aircraft, "onGround" | "gs">;
  assignment?: RunwayAssignment | null;
  arrival?: Arrival | null;
  departure?: DepartureEvent | null;
}): FlightStatus {
  if (departure) {
    const label =
      departure.phase === "roll"
        ? "cleared for takeoff"
        : departure.phase === "climb"
          ? "climbing out"
          : "waiting";
    return { label, rwy: departure.end };
  }

  if (arrival) {
    // trackLandings holds a just-touched-down arrival at etaSeconds 0 through its rollout.
    const label = arrival.etaSeconds <= 0 ? (ac.onGround ? "just landed" : "landing") : "on approach";
    return { label, rwy: arrival.end };
  }

  if (assignment) {
    const label =
      assignment.phase === "approach"
        ? "on approach"
        : assignment.phase === "runway"
          ? "on the runway"
          : "departing";
    return { label, rwy: assignment.end };
  }

  if (ac.onGround) {
    return { label: (ac.gs ?? 0) > 5 ? "taxiing" : "on the ground" };
  }

  return { label: null }; // airborne, no field relation — caller shows motion only
}
