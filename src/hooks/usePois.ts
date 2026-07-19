import { useCallback, useSyncExternalStore } from "react";

/** A user-defined region of interest pinned to the map. */
export interface Poi {
  id: string;
  label: string;
  lat: number;
  lon: number;
  emoji: string;
}

const KEY = "zrh:pois";

function read(): Poi[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Poi[]) : [];
  } catch {
    return [];
  }
}

// External store so every subscriber (map layer + manager) stays in sync.
const listeners = new Set<() => void>();
let cache = read();

function write(next: Poi[]) {
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `poi-${cache.length}-${cache.reduce((n, p) => n + p.id.length, 0)}`;
}

export function usePois() {
  const pois = useSyncExternalStore(subscribe, () => cache);

  const add = useCallback((poi: Omit<Poi, "id">) => {
    write([...read(), { ...poi, id: newId() }]);
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((p) => p.id !== id));
  }, []);

  return { pois, add, remove };
}
