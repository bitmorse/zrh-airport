import { useEffect, useState } from "react";

/** A clock that ticks every `intervalMs`, for live "x seconds ago" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * A requestAnimationFrame clock throttled to ~`minIntervalMs` (default ~10 Hz), for
 * smoothly dead-reckoned readouts. Pauses automatically when the tab is hidden.
 */
export function useRafNow(minIntervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = () => {
      const t = Date.now();
      if (t - last >= minIntervalMs) {
        last = t;
        setNow(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [minIntervalMs]);
  return now;
}
