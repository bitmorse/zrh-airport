import { useEffect, useRef } from "react";
import {
  GPWS_SCHEDULE,
  createGpwsState,
  gpwsAdvance,
  heightAglFt,
  type GpwsState,
} from "../domain/gpws";
import { useAirport } from "./useAirport";
import type { AircraftWithAssignment } from "./useLiveTraffic";

/**
 * Plays GPWS altitude callouts (real recordings) for the selected aircraft while
 * `enabled`. ADS-B polls are seconds apart, so we dead-reckon height between them
 * from the vertical rate and tick a few times a second, driving a latching state
 * machine that speaks each callout once per approach (incl. minimums / retard),
 * only while descending and airborne. The checkbox that flips `enabled` is the user
 * gesture that unlocks audio playback.
 */
export function useGpws(item: AircraftWithAssignment | null, enabled: boolean): void {
  const { fieldElevationFt, geoidFt } = useAirport().config;
  const base = useRef({ agl: 0, ts: 0, vrFps: 0, onGround: false, hex: "" });
  const lastEst = useRef(0);
  const state = useRef<GpwsState>(createGpwsState(Number.POSITIVE_INFINITY));
  const audio = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Warm the callout audio cache when enabled (one <audio> per cue).
  useEffect(() => {
    if (!enabled || typeof Audio === "undefined") return;
    for (const c of GPWS_SCHEDULE) {
      if (!audio.current.has(c.url)) {
        const a = new Audio(c.url);
        a.preload = "auto";
        audio.current.set(c.url, a);
      }
    }
  }, [enabled]);

  // Refresh the dead-reckoning base whenever a new poll delivers fresh data, and
  // (re)start the state machine when the selected aircraft changes.
  useEffect(() => {
    if (!enabled || !item) return;
    const { ac } = item;
    const agl = heightAglFt(ac, fieldElevationFt, geoidFt ?? 0);
    if (base.current.hex !== ac.hex) {
      state.current = createGpwsState(agl);
      lastEst.current = agl;
    }
    base.current = {
      agl,
      ts: Date.now(),
      vrFps: (ac.verticalRateFpm ?? 0) / 60,
      onGround: ac.onGround,
      hex: ac.hex,
    };
  }, [enabled, item, fieldElevationFt, geoidFt]);

  const activeHex = enabled && item ? item.ac.hex : null;
  useEffect(() => {
    if (!activeHex) return;

    const id = setInterval(() => {
      const b = base.current;
      const est = b.agl + b.vrFps * ((Date.now() - b.ts) / 1000);
      const descending = est < lastEst.current - 1; // net descent, ignore tiny noise
      lastEst.current = est;
      for (const c of gpwsAdvance(state.current, { aglFt: est, descending, onGround: b.onGround })) {
        const a = audio.current.get(c.url);
        if (a) {
          a.currentTime = 0;
          void a.play().catch(() => {});
        }
      }
    }, 400);

    return () => clearInterval(id);
  }, [activeHex]);
}
