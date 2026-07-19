import { useCallback, useSyncExternalStore } from "react";
import { ATC_ROLES, type AtcRole } from "../data/atcFeeds";

/**
 * Per-airport ATC stream URLs, bring-your-own, persisted in localStorage. Keyed
 * by `${icao}:${role}` so each airport keeps its own set. Same external-store
 * pattern as usePois. URLs never leave the browser; audio plays client-side.
 */
type UrlMap = Record<string, string>;

const KEY = "atc:urls";
const keyFor = (icao: string, role: AtcRole) => `${icao}:${role}`;

function read(): UrlMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as UrlMap) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let cache = read();

function emit() {
  for (const l of listeners) l();
}

function write(next: UrlMap) {
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cache = read();
      emit();
    }
  });
}

export interface FeedWithUrl {
  role: AtcRole;
  label: string;
  url: string;
}

export function useAtcFeeds(icao: string): {
  feeds: FeedWithUrl[];
  setUrl: (role: AtcRole, url: string) => void;
} {
  const map = useSyncExternalStore(subscribe, () => cache);
  const feeds = ATC_ROLES.map((f) => ({ ...f, url: map[keyFor(icao, f.role)] ?? "" }));

  const setUrl = useCallback(
    (role: AtcRole, url: string) => {
      const next = { ...read() };
      const k = keyFor(icao, role);
      const trimmed = url.trim();
      if (trimmed) next[k] = trimmed;
      else delete next[k];
      write(next);
    },
    [icao],
  );

  return { feeds, setUrl };
}
