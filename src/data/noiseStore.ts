import { del, get, set } from "idb-keyval";

/** One sample of the observer's (phone GPS) position during a recording. */
export interface NoiseObserverPoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
}

/** One sample of a candidate aircraft's position + its slant range to the observer. */
export interface NoiseCandidatePoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
  alt: number | null; // ft MSL (as stored in the aircraft trail)
  distanceM: number; // slant range to the observer at time t
}

/**
 * A nearby aircraft captured for a recording, with its position/distance track over
 * the clip window. The nearest candidate (smallest `closestApproachM`) is the
 * auto-chosen primary label; the user can re-label to any other candidate. Kept so
 * attribution is never a lossy guess — the full picture is available for later.
 */
export interface NoiseCandidate {
  hex: string;
  callsign: string | null;
  aircraftType: string | null;
  aircraftTypeDesc: string | null;
  registration: string | null;
  /** Minimum slant range (m) to the observer over the clip window. */
  closestApproachM: number;
  /** Per-sample track over the window, oldest → newest. */
  track: NoiseCandidatePoint[];
  /**
   * State at the closest-approach point, used to denormalize the primary fields.
   * Position/alt/time are per-instant; kinematics come from the live feed at save
   * time (trails carry no gs/track/vrate).
   */
  closest: {
    t: number;
    gsKt: number | null;
    altFt: number | null;
    trackDeg: number | null;
    verticalRateFpm: number | null;
    acLat: number;
    acLon: number;
  };
}

/**
 * A recorded landing-noise measurement, stored fully offline in IndexedDB. The
 * audio blob is kept under a separate key so the metadata list stays small.
 *
 * The top-level `hex`/`callsign`/`aircraft*`/`gsKt`… fields are the **primary**
 * (chosen) aircraft, denormalized for display/export. `candidates` holds every
 * nearby aircraft with its track so the label can be corrected later without losing
 * information. Older events predate this and simply have no `candidates`.
 */
export interface NoiseEvent {
  id: string;
  hex: string | null;
  callsign: string | null;
  runwayEnd: string | null;
  kind: "arrival" | "departure" | "geofence" | null;
  /** For geofence-triggered clips: the fence radius (metres) in force at recording. */
  geofenceRadiusM: number | null;
  /** ICAO type designator, description and registration, from the ADS-B feed. */
  aircraftType: string | null;
  aircraftTypeDesc: string | null;
  registration: string | null;
  /** Aircraft state captured at the runway event (start of recording). */
  gsKt: number | null;
  altFt: number | null;
  track: number | null;
  verticalRateFpm: number | null;
  acLat: number | null;
  acLon: number | null;
  /** For departures: seconds held at the threshold before the takeoff roll. */
  heldSeconds: number | null;
  /** The observer's (phone) location, from GPS. */
  lat: number | null;
  lon: number | null;
  /** Peak / average loudness in dBFS (≤ 0; higher = louder). Uncalibrated. */
  peakDbfs: number;
  avgDbfs: number;
  startedAt: number; // epoch ms
  durationMs: number;
  hasAudio: boolean;
  /** Every nearby aircraft captured for the clip, sorted nearest-first (optional). */
  candidates?: NoiseCandidate[];
  /** The observer's GPS track over the clip window (optional). */
  observerTrack?: NoiseObserverPoint[];
  /** Hex of the primary candidate (mirrors `hex`); null when nothing was in range. */
  primaryHex?: string | null;
  /** The capture radius (m) used to gather candidates. */
  captureRadiusM?: number;
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

/**
 * Re-attribute a recording to one of its captured candidates: rewrite the
 * denormalized primary fields from that candidate (identity + its closest-approach
 * state), leaving the trigger classification (`kind`/`runwayEnd`) untouched. No-op
 * if the event or candidate isn't found.
 */
export async function relabelNoiseEvent(id: string, hex: string): Promise<void> {
  await ensureLoaded();
  let changed = false;
  cache = cache.map((e) => {
    if (e.id !== id) return e;
    const c = e.candidates?.find((x) => x.hex === hex);
    if (!c) return e;
    changed = true;
    return {
      ...e,
      hex: c.hex,
      primaryHex: c.hex,
      callsign: c.callsign,
      aircraftType: c.aircraftType,
      aircraftTypeDesc: c.aircraftTypeDesc,
      registration: c.registration,
      gsKt: c.closest.gsKt,
      altFt: c.closest.altFt,
      track: c.closest.trackDeg,
      verticalRateFpm: c.closest.verticalRateFpm,
      acLat: c.closest.acLat,
      acLon: c.closest.acLon,
    };
  });
  if (!changed) return;
  await set(EVENTS_KEY, cache);
  emit();
}

/** dBFS (≤0) → an intuitive 0–100 "relative loudness". Uncalibrated. */
export function relLoudness(dbfs: number): number {
  return Math.max(0, Math.min(100, Math.round(100 + dbfs)));
}
