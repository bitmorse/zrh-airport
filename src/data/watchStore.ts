import { get, set } from "idb-keyval";
import type { LatLon } from "../lib/geo";

/** One sample of a flight's path: position, altitude (ft, may be null), and time. */
export interface TrailPoint extends LatLon {
  alt: number | null;
  t: number;
}

/**
 * A flight the user watched (selected) through to a full landing or takeoff — the
 * gamification record. Stored fully offline (IndexedDB), including the captured
 * trajectory so the stats modal can redraw its altitude plot and map later.
 */
export interface WatchedFlight {
  id: string;
  hex: string;
  callsign: string | null;
  type: string | null;
  registration: string | null;
  kind: "landing" | "takeoff";
  end: string | null;
  completedAt: number;
  /** 1, or 2 when a GPS-tagged audio recording was captured for this flight. */
  points: 1 | 2;
  hadGpsAudio: boolean;
  trajectory: TrailPoint[];
}

const KEY = "zrh:watched:v1";

// External store so the header counter and modal re-render on add/remove.
const listeners = new Set<() => void>();
let cache: WatchedFlight[] = [];
let loaded = false;

function emit() {
  for (const l of listeners) l();
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  cache = (await get<WatchedFlight[]>(KEY)) ?? [];
  emit();
}

export function subscribeWatched(cb: () => void): () => void {
  listeners.add(cb);
  void ensureLoaded();
  return () => listeners.delete(cb);
}

export function getWatchedSnapshot(): WatchedFlight[] {
  return cache;
}

export async function addWatch(w: WatchedFlight): Promise<void> {
  await ensureLoaded();
  cache = [w, ...cache];
  await set(KEY, cache);
  emit();
}

export async function removeWatch(id: string): Promise<void> {
  await ensureLoaded();
  cache = cache.filter((w) => w.id !== id);
  await set(KEY, cache);
  emit();
}

/** Total gamification score: sum of per-flight points (1 or 2). Pure. */
export function totalPoints(list: WatchedFlight[]): number {
  return list.reduce((s, w) => s + w.points, 0);
}
