import { useEffect, useRef } from "react";
import { heightAglFt, nextCallouts } from "../domain/gpws";
import { useAirport } from "./useAirport";
import type { AircraftWithAssignment } from "./useLiveTraffic";

/**
 * Speaks GPWS altitude callouts for the selected aircraft while `enabled`. ADS-B
 * polls are seconds apart, so we dead-reckon height between them from the vertical
 * rate (like the map does for position) and tick a few times a second, speaking any
 * callout the aircraft has just descended through. The checkbox that flips `enabled`
 * is the user gesture that unlocks speech synthesis.
 */
export function useGpws(item: AircraftWithAssignment | null, enabled: boolean): void {
  const { fieldElevationFt, geoidFt } = useAirport().config;
  // Dead-reckoning base, refreshed each poll.
  const base = useRef({ agl: 0, ts: 0, vrFps: 0, hex: "" });
  const prevFt = useRef(Number.POSITIVE_INFINITY);

  // Refresh the base whenever a new poll delivers fresh data for the selection.
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
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!activeHex || !synth) return;
    prevFt.current = base.current.agl; // don't blast past callouts on enable

    const id = setInterval(() => {
      const b = base.current;
      const est = b.agl + b.vrFps * ((Date.now() - b.ts) / 1000);
      for (const c of nextCallouts(prevFt.current, est)) {
        const u = new SpeechSynthesisUtterance(c.say);
        u.rate = 1.15;
        synth.speak(u);
      }
      prevFt.current = est;
    }, 400);

    return () => {
      clearInterval(id);
      synth.cancel();
    };
  }, [activeHex]);
}
