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

function emit() {
  for (const l of listeners) l();
}

function write(next: Poi[]) {
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Reflect edits made in another tab.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cache = read();
      emit();
    }
  });
}

let idCounter = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `poi-${Date.now()}-${idCounter++}`;
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
