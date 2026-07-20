import { useEffect, useRef, useState } from "react";
import {
  GPWS_SCHEDULE,
  createGpwsState,
  gpwsAdvance,
  heightAglFt,
  type GpwsCue,
  type GpwsState,
} from "../domain/gpws";
import * as gpwsAudio from "../lib/gpwsAudio";
import { useAirport } from "./useAirport";
import type { AircraftWithAssignment } from "./useLiveTraffic";

/** Human-readable callout label (raw feet / word) — unit-independent, for the readout. */
function calloutLabel(c: GpwsCue): string {
  if (c.key === "minimums") return "MINIMUMS";
  if (c.key === "retard") return "RETARD";
  return c.key; // the number, e.g. "100"
}

export interface GpwsReadout {
  /** The most recent callout label (e.g. "100"), cleared a few seconds after it fires. */
  callout: string | null;
}

/**
 * GPWS altitude callouts for the selected aircraft. The playback engine is a single
 * persistent loop that is NEVER torn down by UI churn — selecting/unselecting the same
 * aircraft, toggling mute/record, or opening/closing panels does not cut an in-flight
 * callout or drop the queue. State is tracked in refs; the latching state machine is
 * only re-armed when the tracked aircraft actually changes (a different hex) or the
 * aircraft climbs back above the go-around gate.
 *
 * Two independent gates:
 *   - `active`  (cockpit sim on): run the state machine and surface each callout as a
 *     visual readout — even while muted/recording, so the data layer is observable
 *     without relying on the audio cue.
 *   - `audible` (active, not muted, not recording): actually play the recorded audio.
 *
 * ADS-B polls are seconds apart, so we dead-reckon height between them from the vertical
 * rate and tick a few times a second; callouts are spoken strictly one at a time.
 */
export function useGpws(
  item: AircraftWithAssignment | null,
  { active, audible }: { active: boolean; audible: boolean },
): GpwsReadout {
  const { fieldElevationFt, geoidFt } = useAirport().config;

  // Persistent engine state (survives every render / selection change).
  const base = useRef({ agl: 0, ts: 0, vrFps: 0, onGround: false, hex: "" });
  const lastEst = useRef(0);
  const state = useRef<GpwsState>(createGpwsState(Number.POSITIVE_INFINITY));
  const stateHex = useRef<string | null>(null); // aircraft the state machine is armed for

  // Live gates, read by the persistent loop without re-subscribing.
  const targetHex = useRef<string | null>(null);
  targetHex.current = active && item ? item.ac.hex : null;
  const audibleRef = useRef(audible);
  const wasAudible = useRef(audible);
  audibleRef.current = audible;

  const [callout, setCallout] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCallout = useRef((label: string) => {
    setCallout(label);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setCallout(null), 3500);
  });

  // Decode the callout clips once the sim is active (a no-op where Web Audio isn't
  // available, e.g. tests — the visual readout still fires).
  useEffect(() => {
    if (!active) return;
    gpwsAudio.load(GPWS_SCHEDULE.map((c) => c.url));
  }, [active]);

  // Refresh the dead-reckoning base from each poll, and re-arm the state machine ONLY
  // when the tracked aircraft actually changes. A brief deselect + reselect of the same
  // hex leaves `stateHex` intact, so playback resumes instead of restarting/cutting.
  useEffect(() => {
    if (!active || !item) return; // deselected/inactive — leave the engine untouched
    const { ac } = item;
    const agl = heightAglFt(ac, fieldElevationFt, geoidFt ?? 0);
    if (stateHex.current !== ac.hex) {
      // Genuinely new aircraft — fresh approach: re-arm and cut the old plane's callouts.
      state.current = createGpwsState(agl);
      stateHex.current = ac.hex;
      lastEst.current = agl;
      gpwsAudio.stopAll();
    }
    base.current = {
      agl,
      ts: Date.now(),
      vrFps: (ac.verticalRateFpm ?? 0) / 60,
      onGround: ac.onGround,
      hex: ac.hex,
    };
  }, [active, item, fieldElevationFt, geoidFt]);

  // The one and only playback loop. Created once, cleared only on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      // Muted / recording just went into effect: cut any scheduled callouts once (not
      // every tick). The visual readout keeps running regardless.
      if (!audibleRef.current && wasAudible.current) gpwsAudio.stopAll();
      wasAudible.current = audibleRef.current;

      // No active target (deselected / sim off): stop advancing. Scheduled callouts on
      // the audio clock finish on their own — never cut here.
      const tgt = targetHex.current;
      if (!tgt || stateHex.current !== tgt) return;

      const b = base.current;
      const est = b.agl + b.vrFps * ((Date.now() - b.ts) / 1000);
      const descending = est < lastEst.current - 1; // net descent, ignore tiny noise
      lastEst.current = est;

      const cues = gpwsAdvance(state.current, { aglFt: est, descending, onGround: b.onGround });
      for (const c of cues) {
        flashCallout.current(calloutLabel(c)); // data-layer readout, even when muted
        if (audibleRef.current) gpwsAudio.play(c.url); // serialised on the audio clock
      }
    }, 400);

    return () => {
      clearInterval(id);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      gpwsAudio.stopAll();
    };
  }, []);

  return { callout };
}
