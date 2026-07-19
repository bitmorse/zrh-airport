import { get, set } from "idb-keyval";

/** A single sighting of an aircraft attributed to a runway end. */
export interface Observation {
  hex: string;
  end: string;
  ts: number;
}

export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const STORE_KEY = "zrh:observations";

/** Drop observations older than `windowMs` relative to `now`. Pure. */
export function pruneObservations(
  obs: Observation[],
  now: number,
  windowMs = WINDOW_MS,
): Observation[] {
  const cutoff = now - windowMs;
  return obs.filter((o) => o.ts >= cutoff);
}

/** Distinct aircraft count per runway end. Pure. */
export function countsByEnd(obs: Observation[]): Record<string, number> {
  const byEnd = new Map<string, Set<string>>();
  for (const o of obs) {
    let set = byEnd.get(o.end);
    if (!set) {
      set = new Set();
      byEnd.set(o.end, set);
    }
    set.add(o.hex);
  }
  const out: Record<string, number> = {};
  for (const [end, hexes] of byEnd) out[end] = hexes.size;
  return out;
}

export async function loadObservations(): Promise<Observation[]> {
  return (await get<Observation[]>(STORE_KEY)) ?? [];
}

// Serialize writes: loadObservations()→set() is a non-atomic round-trip, so
// overlapping polls could otherwise read the same array and clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();

async function doRecord(
  assignments: { hex: string; end: string }[],
  now: number,
): Promise<{ observations: Observation[]; counts: Record<string, number> }> {
  const existing = await loadObservations();
  const appended = existing.concat(
    assignments.map((a) => ({ hex: a.hex, end: a.end, ts: now })),
  );
  const pruned = pruneObservations(appended, now);
  await set(STORE_KEY, pruned);
  return { observations: pruned, counts: countsByEnd(pruned) };
}

/**
 * Append this poll's assignments to the rolling window, prune stale entries,
 * persist, and return the fresh per-end distinct-aircraft counts. Serialized so
 * concurrent polls can't clobber each other's writes.
 */
export function recordSnapshot(
  assignments: { hex: string; end: string }[],
  now: number,
): Promise<{ observations: Observation[]; counts: Record<string, number> }> {
  const result = writeChain.then(() => doRecord(assignments, now));
  writeChain = result.catch(() => {});
  return result;
}
