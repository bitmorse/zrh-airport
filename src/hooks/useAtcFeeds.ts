import { useCallback, useSyncExternalStore } from "react";
import {
  ATC_ROLES,
  DEMO_RECEIVERS,
  type AtcRole,
  type ReceiverConfig,
} from "../data/atcFeeds";

/**
 * Per-airport airport-sdr receiver config (base URL + per-role channel names),
 * persisted in localStorage. Keyed by ICAO so each airport keeps its own receiver.
 * An airport with nothing stored falls back to its shipped demo (DEMO_RECEIVERS);
 * the first edit persists a full config for that airport, overriding the demo. URLs
 * never leave the browser — audio and control run client-side in the embedded frame.
 */
type Store = Record<string, ReceiverConfig>;

const KEY = "atc:sdr";

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Store) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let cache = read();

function emit() {
  for (const l of listeners) l();
}

function write(next: Store) {
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

const EMPTY: ReceiverConfig = { server: "", channels: {} };

/** Stored config for an airport, or its shipped demo default, or empty. */
function configFor(store: Store, icao: string): ReceiverConfig {
  return store[icao] ?? DEMO_RECEIVERS[icao] ?? EMPTY;
}

export interface AtcChannel {
  role: AtcRole;
  label: string;
  /** Channel name on the receiver (the /embed/<name> segment); "" = unconfigured. */
  channel: string;
}

export function useAtcFeeds(icao: string): {
  /** Receiver base URL for this airport ("" when unset). */
  server: string;
  setServer: (url: string) => void;
  /** One entry per standard position, with its resolved channel name. */
  channels: AtcChannel[];
  setChannel: (role: AtcRole, name: string) => void;
} {
  const store = useSyncExternalStore(subscribe, () => cache);
  const cfg = configFor(store, icao);

  const server = cfg.server;
  const channels = ATC_ROLES.map((f) => ({
    role: f.role,
    label: f.label,
    channel: cfg.channels[f.role] ?? "",
  }));

  // Persist the full resolved config for this airport, then patch it — so the first
  // edit "freezes" the demo default into a user-owned config it can then diverge from.
  const patch = useCallback(
    (mut: (c: ReceiverConfig) => ReceiverConfig) => {
      const current = configFor(read(), icao);
      write({ ...read(), [icao]: mut(current) });
    },
    [icao],
  );

  const setServer = useCallback(
    (url: string) => patch((c) => ({ ...c, server: url.trim() })),
    [patch],
  );

  const setChannel = useCallback(
    (role: AtcRole, name: string) =>
      patch((c) => {
        const channels = { ...c.channels };
        const trimmed = name.trim();
        if (trimmed) channels[role] = trimmed;
        else delete channels[role];
        return { ...c, channels };
      }),
    [patch],
  );

  return { server, setServer, channels, setChannel };
}
