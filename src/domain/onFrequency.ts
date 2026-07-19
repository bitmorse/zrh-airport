import type { AtcRole } from "../data/atcFeeds";
import type { DeparturePhase, DepartureEvent } from "./departures";
import type { Arrival } from "./predictions";

/**
 * The bridge that answers "what runway / what aircraft is this stream about?".
 * ATC audio carries no metadata, but the app already infers, from ADS-B, which
 * aircraft are on approach/departure to which runway. Given a frequency's role we
 * surface the aircraft plausibly on that position, ranked by how imminent they are
 * (a takeoff roll or short final is what a controller is most likely addressing).
 * It's a best-guess candidate set, not a certainty.
 */

export interface Candidate {
  hex: string;
  callsign: string;
  end: string;
  kind: "arrival" | "departure";
  phase: "final" | "holding" | "roll" | "climb";
  /** Arrivals: seconds to threshold. */
  etaSeconds?: number;
  /** Departures on "roll": ms waited at the threshold before the roll began. */
  waitedMs?: number;
  /** Departures "holding": epoch ms it started waiting (for a live count-up). */
  holdingSinceMs?: number;
  /** Sort key — lower is more imminent / more likely being addressed now. */
  rank: number;
}

/** Runway ends with live traffic right now (what the active positions cover). */
export function activeRunwayEnds(
  arrivals: Arrival[],
  departures: DepartureEvent[],
): string[] {
  const ends = new Set<string>();
  for (const a of arrivals) ends.add(a.end);
  for (const d of departures) ends.add(d.end);
  return [...ends];
}

// A jet within ~4 min of touchdown is on Tower; further out it's Approach's.
const TOWER_FINAL_S = 240;
// Ranks interleave with arrival ETA (seconds): a takeoff roll is as imminent as
// it gets; a short final beats a holding aircraft, a long final doesn't.
const DEP_RANK: Record<DeparturePhase, number> = { roll: 0, holding: 90, climb: 200 };
// Which departure phases each position typically works.
const DEP_PHASES: Record<AtcRole, DeparturePhase[]> = {
  approach: [],
  tower: ["holding", "roll", "climb"],
  departure: ["roll", "climb"],
  ground: ["holding"],
};

/** Aircraft plausibly on a given ATC position's frequency, most-imminent first. */
export function onFrequencyCandidates(
  role: AtcRole,
  arrivals: Arrival[],
  departures: DepartureEvent[],
): Candidate[] {
  const out: Candidate[] = [];

  // Approach works all inbounds; Tower only the short finals it has handed to it.
  if (role === "approach" || role === "tower") {
    for (const a of arrivals) {
      if (role === "tower" && a.etaSeconds > TOWER_FINAL_S) continue;
      out.push({
        hex: a.hex,
        callsign: a.callsign,
        end: a.end,
        kind: "arrival",
        phase: "final",
        etaSeconds: a.etaSeconds,
        rank: a.etaSeconds,
      });
    }
  }

  const phases = DEP_PHASES[role];
  for (const d of departures) {
    if (!phases.includes(d.phase)) continue;
    out.push({
      hex: d.hex,
      callsign: d.callsign,
      end: d.end,
      kind: "departure",
      phase: d.phase,
      waitedMs: d.waitedMs,
      holdingSinceMs: d.holdingSinceMs,
      rank: DEP_RANK[d.phase],
    });
  }

  return out.sort((a, b) => a.rank - b.rank);
}
