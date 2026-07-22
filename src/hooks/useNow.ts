import { useEffect, useState } from "react";

/** A clock that ticks every `intervalMs`, for live "x seconds ago" labels. (For
 *  smoothly dead-reckoned ~10 Hz readouts use the shared `useSmoothClock` instead.) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
