import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_AIRPORT_ICAO } from "../data/airports";
import type { Units } from "../lib/format";
import { DEFAULT_ZOOM } from "../lib/viewport";

// Bump when the map projection/zoom semantics change so persisted zoom resets.
const MAP_VERSION = 2;

/**
 * User settings persisted in localStorage. The default data source needs no
 * credentials, but `apiToken` is here so the settings modal can request and
 * store a key without any code change if a provider later requires one.
 */
export interface Settings {
  /** Active airport, by ICAO id (see src/data/airports.ts). */
  airport: string;
  /** Poll interval in seconds. */
  pollSeconds: number;
  /** Query radius around the airport, nautical miles. */
  radiusNm: number;
  /** Preferred provider name, tried first before fallbacks. */
  provider: string | null;
  /** Optional API token, stored locally only (future use). */
  apiToken: string | null;
  /** Display units for distances, speeds and altitudes. */
  units: Units;
  /** Map zoom factor (1 = full extent). */
  zoom: number;
  /** Normalized view centre in [0,1] (0.5,0.5 = airport reference point). */
  cx: number;
  cy: number;
  /** Projection/zoom scheme version (for migrating persisted zoom). */
  mapVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  airport: DEFAULT_AIRPORT_ICAO,
  pollSeconds: 15,
  radiusNm: 25,
  provider: null,
  apiToken: null,
  units: "metric",
  zoom: DEFAULT_ZOOM,
  cx: 0.5,
  cy: 0.5,
  mapVersion: MAP_VERSION,
};

const KEY = "zrh:settings";

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Migrate the old 45 s default (too slow) to the faster default.
    if (parsed.pollSeconds === 45) merged.pollSeconds = DEFAULT_SETTINGS.pollSeconds;
    // The world extent changed, so old zoom values no longer mean the same view —
    // reset to the framed default once.
    if (parsed.mapVersion !== MAP_VERSION) {
      merged.zoom = DEFAULT_SETTINGS.zoom;
      merged.cx = 0.5;
      merged.cy = 0.5;
      merged.mapVersion = MAP_VERSION;
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// A tiny external store so every component re-renders when settings change.
const listeners = new Set<() => void>();
let cache: Settings = read();

function emit() {
  cache = read();
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Reflect settings changed in another tab.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) emit();
  });
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, () => cache);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...read(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  }, []);

  return [settings, update];
}
