import { useEffect, useRef, useState } from "react";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { NoiseRecorder, Recording } from "./useNoiseRecorder";

const LEAD_S = 25; // start ~25 s before predicted touchdown
const POST_ROLL_MS = 22000; // keep recording through the landing roll
const MAX_REC_MS = 80000; // hard cap per clip
const DEP_REC_MS = 45000; // departure clip length (roll → rotate → climb-out)
const DEDUPE_MS = 5 * 60 * 1000; // don't re-record the same aircraft within 5 min

export interface NoiseMeta {
  hex: string;
  callsign: string;
  end: string;
  kind: "arrival" | "departure";
}

/**
 * Auto-records the microphone around landings AND departures. For arrivals it
 * starts ~25 s before the predicted touchdown; for departures it starts at the
 * takeoff-roll onset (the closest ADS-B proxy for "cleared for takeoff"). One clip
 * at a time, deduped per aircraft. Hands each finished clip + aircraft to the
 * caller, which tags it with the live GPS location.
 */
export function useLandingNoiseTrigger(opts: {
  armed: boolean;
  arrivals: Arrival[];
  departures: DepartureEvent[];
  now: number;
  lastUpdated: number | null;
  recorder: NoiseRecorder;
  onComplete: (meta: NoiseMeta, rec: Recording) => void;
}): { activeCallsign: string | null } {
  const { armed, now, lastUpdated, recorder } = opts;
  const [activeCallsign, setActiveCallsign] = useState<string | null>(null);

  const recordingHex = useRef<string | null>(null);
  const recentlyRecorded = useRef(new Map<string, number>());
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meta = useRef<NoiseMeta | null>(null);

  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const onCompleteRef = useRef(opts.onComplete);
  onCompleteRef.current = opts.onComplete;
  const arrivalsRef = useRef(opts.arrivals);
  arrivalsRef.current = opts.arrivals;
  const departuresRef = useRef(opts.departures);
  departuresRef.current = opts.departures;

  const finish = useRef(async () => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    const m = meta.current;
    if (!recordingHex.current || !m) return;
    recordingHex.current = null;
    setActiveCallsign(null);
    const rec = await recorderRef.current.stopRecording();
    recentlyRecorded.current.set(m.hex, Date.now());
    onCompleteRef.current(m, rec);
    meta.current = null;
  });

  useEffect(() => {
    if (!armed || recordingHex.current || recorder.isRecording || lastUpdated == null)
      return;

    const notRecent = (hex: string) => {
      const t = recentlyRecorded.current.get(hex);
      return !(t && Date.now() - t < DEDUPE_MS);
    };
    const start = (m: NoiseMeta, durMs: number) => {
      recordingHex.current = m.hex;
      meta.current = m;
      recorderRef.current.startRecording();
      setActiveCallsign(m.callsign);
      stopTimer.current = setTimeout(() => void finish.current(), durMs);
    };

    // Priority 1: a takeoff roll happening right now.
    const roll = departuresRef.current.find(
      (d) => d.phase === "roll" && notRecent(d.hex),
    );
    if (roll) {
      start(
        { hex: roll.hex, callsign: roll.callsign, end: roll.end, kind: "departure" },
        DEP_REC_MS,
      );
      return;
    }

    // Priority 2: an imminent arrival.
    const ageSec = (now - lastUpdated) / 1000;
    for (const a of arrivalsRef.current) {
      const remaining = a.etaSeconds - ageSec;
      if (remaining > LEAD_S) break; // sorted soonest-first
      if (remaining < -(POST_ROLL_MS / 1000)) continue;
      if (!notRecent(a.hex)) continue;
      const durMs = Math.min(MAX_REC_MS, Math.max(0, remaining) * 1000 + POST_ROLL_MS);
      start({ hex: a.hex, callsign: a.callsign, end: a.end, kind: "arrival" }, durMs);
      break;
    }
  }, [armed, now, lastUpdated, recorder.isRecording]);

  useEffect(() => {
    if (!armed && recordingHex.current) void finish.current();
  }, [armed]);

  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [],
  );

  return { activeCallsign };
}
