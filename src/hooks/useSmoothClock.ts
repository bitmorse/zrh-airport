import { useEffect, useState } from "react";

/**
 * A clock that updates several times a second via requestAnimationFrame, for
 * smooth animation (e.g. dead-reckoning plane positions between polls). Throttled
 * to ~`intervalMs` so it doesn't re-render at the full frame rate.
 */
export function useSmoothClock(intervalMs = 120): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= intervalMs) {
        last = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [intervalMs]);
  return now;
}
