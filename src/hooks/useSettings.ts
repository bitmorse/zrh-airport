import { useCallback, useSyncExternalStore } from "react";

/**
 * User settings persisted in localStorage. The default data source needs no
 * credentials, but `apiToken` is here so the settings modal can request and
 * store a key without any code change if a provider later requires one.
 */
export interface Settings {
  /** Poll interval in seconds. */
  pollSeconds: number;
  /** Query radius around ZRH, nautical miles. */
  radiusNm: number;
  /** Preferred provider name, tried first before fallbacks. */
  provider: string | null;
  /** Optional API token, stored locally only (future use). */
  apiToken: string | null;
  /** Map zoom factor (1 = full extent). */
  zoom: number;
  /** Normalized view centre in [0,1] (0.5,0.5 = airport reference point). */
  cx: number;
  cy: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pollSeconds: 45,
  radiusNm: 25,
  provider: null,
  apiToken: null,
  zoom: 1,
  cx: 0.5,
  cy: 0.5,
};

const KEY = "zrh:settings";

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, () => cache);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...read(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  }, []);

  return [settings, update];
}
