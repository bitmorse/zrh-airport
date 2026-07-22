import { useSyncExternalStore } from "react";

/**
 * A single ~10 Hz clock for the whole app: one `requestAnimationFrame` loop, shared by
 * every subscriber via `useSyncExternalStore`. Because they all read the *same* `now` on
 * the *same* tick, dead-reckoned values that must agree — the plane glyph and its
 * trajectory trail's leading end, the detail-panel readout — stay in lock-step instead of
 * drifting apart the way independent per-component rAF clocks did. Throttled so it doesn't
 * re-render at the full frame rate; rAF naturally pauses while the tab is hidden.
 */
const TICK_MS = 100;

let now = Date.now();
let raf = 0;
let last = 0;
const listeners = new Set<() => void>();

function loop(t: number): void {
  if (t - last >= TICK_MS) {
    last = t;
    now = Date.now();
    for (const l of listeners) l();
  }
  raf = requestAnimationFrame(loop);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    last = 0; // fire on the first frame after (re)starting
    raf = requestAnimationFrame(loop);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

const getSnapshot = () => now;

/** The shared smooth clock (epoch ms), ~10 Hz. */
export function useSmoothClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
