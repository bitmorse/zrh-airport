import { del, get, set } from "idb-keyval";

/**
 * A recorded landing-noise measurement, stored fully offline in IndexedDB. The
 * audio blob is kept under a separate key so the metadata list stays small.
 */
export interface NoiseEvent {
  id: string;
  hex: string | null;
  callsign: string | null;
  runwayEnd: string | null;
  kind: "arrival" | "departure" | null;
  /** For departures: seconds held at the threshold before the takeoff roll. */
  heldSeconds: number | null;
  lat: number | null;
  lon: number | null;
  /** Peak / average loudness in dBFS (≤ 0; higher = louder). Uncalibrated. */
  peakDbfs: number;
  avgDbfs: number;
  startedAt: number; // epoch ms
  durationMs: number;
  hasAudio: boolean;
}

const EVENTS_KEY = "zrh:noise:events";
const audioKey = (id: string) => `zrh:noise:audio:${id}`;

// External store so the table re-renders on add/remove.
const listeners = new Set<() => void>();
let cache: NoiseEvent[] = [];
let loaded = false;

function emit() {
  for (const l of listeners) l();
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  cache = (await get<NoiseEvent[]>(EVENTS_KEY)) ?? [];
  emit();
}

export function subscribeNoise(cb: () => void): () => void {
  listeners.add(cb);
  void ensureLoaded();
  return () => listeners.delete(cb);
}

export function getNoiseSnapshot(): NoiseEvent[] {
  return cache;
}

export async function addNoiseEvent(ev: NoiseEvent, blob: Blob | null): Promise<void> {
  await ensureLoaded();
  if (blob && blob.size > 0) await set(audioKey(ev.id), blob);
  cache = [ev, ...cache];
  await set(EVENTS_KEY, cache);
  emit();
}

export async function removeNoiseEvent(id: string): Promise<void> {
  await ensureLoaded();
  cache = cache.filter((e) => e.id !== id);
  await set(EVENTS_KEY, cache);
  await del(audioKey(id));
  emit();
}

export function getNoiseAudio(id: string): Promise<Blob | undefined> {
  return get<Blob>(audioKey(id));
}

/** dBFS (≤0) → an intuitive 0–100 "relative loudness". Uncalibrated. */
export function relLoudness(dbfs: number): number {
  return Math.max(0, Math.min(100, Math.round(100 + dbfs)));
}
