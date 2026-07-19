import { useEffect, useRef } from "react";
import { CALLOUTS, heightAglFt, nextCallouts } from "../domain/gpws";
import { useAirport } from "./useAirport";
import type { AircraftWithAssignment } from "./useLiveTraffic";

/**
 * Plays GPWS altitude callouts (real recordings) for the selected aircraft while
 * `enabled`. ADS-B polls are seconds apart, so we dead-reckon height between them
 * from the vertical rate (like the map does for position) and tick a few times a
 * second, playing any callout the aircraft has just descended through. The checkbox
 * that flips `enabled` is the user gesture that unlocks audio playback.
 */
export function useGpws(item: AircraftWithAssignment | null, enabled: boolean): void {
  const { fieldElevationFt, geoidFt } = useAirport().config;
  const base = useRef({ agl: 0, ts: 0, vrFps: 0, hex: "" });
  const prevFt = useRef(Number.POSITIVE_INFINITY);
  const audio = useRef<Map<number, HTMLAudioElement>>(new Map());

  // Warm the callout audio cache when enabled (one <audio> per height).
  useEffect(() => {
    if (!enabled || typeof Audio === "undefined") return;
    for (const c of CALLOUTS) {
      if (!audio.current.has(c.ft)) {
        const a = new Audio(c.url);
        a.preload = "auto";
        audio.current.set(c.ft, a);
      }
    }
  }, [enabled]);

  // Refresh the dead-reckoning base whenever a new poll delivers fresh data.
  useEffect(() => {
    if (!enabled || !item) return;
    const { ac } = item;
    const agl = heightAglFt(ac, fieldElevationFt, geoidFt ?? 0);
    if (base.current.hex !== ac.hex) prevFt.current = agl; // new aircraft — start here
    base.current = { agl, ts: Date.now(), vrFps: (ac.verticalRateFpm ?? 0) / 60, hex: ac.hex };
  }, [enabled, item, fieldElevationFt, geoidFt]);

  // Restart only when enabling/disabling or changing which aircraft is selected.
  const activeHex = enabled && item ? item.ac.hex : null;
  useEffect(() => {
    if (!activeHex) return;
    prevFt.current = base.current.agl; // don't blast past callouts on enable

    const id = setInterval(() => {
      const b = base.current;
      const est = b.agl + b.vrFps * ((Date.now() - b.ts) / 1000);
      for (const c of nextCallouts(prevFt.current, est)) {
        const a = audio.current.get(c.ft);
        if (a) {
          a.currentTime = 0;
          void a.play().catch(() => {});
        }
      }
      prevFt.current = est;
    }, 400);

    return () => clearInterval(id);
  }, [activeHex]);
}
