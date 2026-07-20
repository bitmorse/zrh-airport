/**
 * Turn the live arrival/departure state into discrete, counted movement events —
 * one landing per touchdown, one takeoff per lift-off — which are then bucketed
 * into the per-airport "traffic by hour" history.
 */
import type { DeparturePhase } from "./departures";

export type MovementKind = "landing" | "takeoff";

export interface Movement {
  kind: MovementKind;
  hex: string;
  end: string;
  ts: number;
}

/**
 * A landing (rollout) or takeoff (climb-out) stays visible for several polls, so
 * each aircraft's movement is counted once and only re-armed after this quiet gap —
 * long enough to not double-count one movement, short enough that a later flight on
 * the same airframe is still counted.
 */
export const MOVEMENT_COOLDOWN_MS = 20 * 60 * 1000;

interface ArrivalLike {
  hex: string;
  end: string;
  etaSeconds: number;
}
interface DepartureLike {
  hex: string;
  end: string;
  phase: DeparturePhase;
}

/**
 * Extract new movement events from this poll's arrivals/departures:
 *   landing — an arrival that has reached the runway (`etaSeconds === 0`, i.e. it
 *             has touched down and is rolling out);
 *   takeoff — a departure that has lifted off (`phase === "climb"`).
 * Both states persist across polls, so `counted` (hex → last-count ts, kept across
 * polls) de-duplicates each aircraft to one event per movement, re-arming after
 * `cooldownMs`. Mutates `counted` and prunes its stale entries; returns only the
 * new events.
 */
export function detectMovements(
  arrivals: ArrivalLike[],
  departures: DepartureLike[],
  counted: Map<string, number>,
  nowMs: number,
  cooldownMs = MOVEMENT_COOLDOWN_MS,
): Movement[] {
  const out: Movement[] = [];
  const mark = (kind: MovementKind, hex: string, end: string) => {
    const key = `${kind}:${hex}`;
    const last = counted.get(key);
    if (last != null && nowMs - last < cooldownMs) return;
    counted.set(key, nowMs);
    out.push({ kind, hex, end, ts: nowMs });
  };
  for (const a of arrivals) if (a.etaSeconds === 0) mark("landing", a.hex, a.end);
  for (const d of departures) if (d.phase === "climb") mark("takeoff", d.hex, d.end);
  for (const [k, t] of [...counted]) if (nowMs - t >= cooldownMs) counted.delete(k);
  return out;
}
