import { useEffect, useRef, useState } from "react";
import type { Arrival } from "../domain/predictions";
import type { NoiseRecorder, Recording } from "./useNoiseRecorder";

const LEAD_S = 20; // start recording ~20 s before predicted touchdown
const POST_ROLL_MS = 15000; // keep recording through the landing roll
const MAX_REC_MS = 55000; // hard cap per clip
const DEDUPE_MS = 5 * 60 * 1000; // don't re-record the same aircraft within 5 min

export interface LandingMeta {
  hex: string;
  callsign: string;
  end: string;
}
export interface RecordLocation {
  lat: number | null;
  lon: number | null;
}

/**
 * Auto-records the microphone around each predicted landing: starts ~20 s before
 * the estimated touchdown and stops after the roll-out. One clip at a time. On
 * completion it hands back the recording plus the aircraft + GPS location for the
 * caller to persist.
 */
export function useLandingNoiseTrigger(opts: {
  armed: boolean;
  arrivals: Arrival[];
  now: number;
  lastUpdated: number | null;
  recorder: NoiseRecorder;
  onComplete: (meta: LandingMeta, rec: Recording, loc: RecordLocation) => void;
}): { activeCallsign: string | null } {
  const { armed, now, lastUpdated, recorder } = opts;
  const [activeCallsign, setActiveCallsign] = useState<string | null>(null);

  const recordingHex = useRef<string | null>(null);
  const recentlyRecorded = useRef(new Map<string, number>());
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meta = useRef<LandingMeta | null>(null);
  const loc = useRef<RecordLocation>({ lat: null, lon: null });

  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const onCompleteRef = useRef(opts.onComplete);
  onCompleteRef.current = opts.onComplete;
  const arrivalsRef = useRef(opts.arrivals);
  arrivalsRef.current = opts.arrivals;

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
    onCompleteRef.current(m, rec, loc.current);
    meta.current = null;
  });

  useEffect(() => {
    if (!armed || recordingHex.current || recorder.isRecording || lastUpdated == null)
      return;
    const ageSec = (now - lastUpdated) / 1000;
    for (const a of arrivalsRef.current) {
      const remaining = a.etaSeconds - ageSec;
      if (remaining > LEAD_S) break; // sorted soonest-first
      if (remaining < -(POST_ROLL_MS / 1000)) continue; // already landed
      const last = recentlyRecorded.current.get(a.hex);
      if (last && Date.now() - last < DEDUPE_MS) continue;

      recordingHex.current = a.hex;
      meta.current = { hex: a.hex, callsign: a.callsign, end: a.end };
      loc.current = { lat: null, lon: null };
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            loc.current = { lat: p.coords.latitude, lon: p.coords.longitude };
          },
          () => {},
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
        );
      }
      recorderRef.current.startRecording();
      setActiveCallsign(a.callsign);
      const durMs = Math.min(MAX_REC_MS, Math.max(0, remaining) * 1000 + POST_ROLL_MS);
      stopTimer.current = setTimeout(() => void finish.current(), durMs);
      break;
    }
  }, [armed, now, lastUpdated, recorder.isRecording]);

  // Stop cleanly if the mic is disarmed mid-recording.
  useEffect(() => {
    if (!armed && recordingHex.current) void finish.current();
  }, [armed]);

  // Cleanup a pending stop timer on unmount.
  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [],
  );

  return { activeCallsign };
}
