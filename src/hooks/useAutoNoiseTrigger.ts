import { useEffect, useRef, useState } from "react";
import { snapshotAircraft, type AircraftSnapshot } from "../data/adsb";
import type { DepartureEvent } from "../domain/departures";
import { insideFence, stillInFence } from "../domain/geofence";
import type { Arrival } from "../domain/predictions";
import type { GeoFix } from "./useGeoWatch";
import type { AircraftWithAssignment } from "./useLiveTraffic";
import type { NoiseRecorder, Recording } from "./useNoiseRecorder";

const LEAD_S = 25; // start ~25 s before predicted touchdown
const POST_ROLL_MS = 22000; // keep recording through the landing roll
const MAX_REC_MS = 80000; // hard cap per clip
const DEP_REC_MS = 45000; // departure clip length (roll → rotate → climb-out)
const GEOFENCE_MAX_MS = 120000; // safety cap if a plane loiters inside the fence
const DEDUPE_MS = 5 * 60 * 1000; // don't re-record the same aircraft within 5 min

export interface NoiseMeta {
  hex: string;
  callsign: string;
  end: string;
  kind: "arrival" | "departure" | "geofence";
  /** For departures: how long it waited at the threshold before the roll (ms). */
  heldMs?: number;
  /** For geofence clips: the fence radius (m) in force when recording started. */
  geofenceRadiusM?: number;
  /** Aircraft state captured when recording started (at the trigger event). */
  snapshot?: AircraftSnapshot;
}

/**
 * Auto-records the microphone. Priority order:
 *   0. Geofence — any aircraft that enters the radius around the observer's GPS
 *      location (and is low enough to hear); the clip runs until the aircraft leaves
 *      the fence (or a safety cap). This takes precedence over landing/takeoff.
 *   1. A takeoff roll happening now (the closest ADS-B proxy for "cleared").
 *   2. An imminent arrival (starts ~25 s before predicted touchdown).
 * One clip at a time, deduped per aircraft. Hands each finished clip + aircraft to
 * the caller, which tags it with the live GPS location.
 */
export function useAutoNoiseTrigger(opts: {
  armed: boolean;
  aircraft: AircraftWithAssignment[];
  arrivals: Arrival[];
  departures: DepartureEvent[];
  now: number;
  lastUpdated: number | null;
  recorder: NoiseRecorder;
  userPos: GeoFix | null;
  geofenceRadiusM: number;
  fieldElevationFt: number;
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
  const aircraftRef = useRef(opts.aircraft);
  aircraftRef.current = opts.aircraft;
  const userPosRef = useRef(opts.userPos);
  userPosRef.current = opts.userPos;
  const fenceRadiusRef = useRef(opts.geofenceRadiusM);
  fenceRadiusRef.current = opts.geofenceRadiusM;
  const fieldElevRef = useRef(opts.fieldElevationFt);
  fieldElevRef.current = opts.fieldElevationFt;

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
    if (!armed || lastUpdated == null) return;

    // A geofence clip ends when its target leaves the fence (or the feed), checked
    // each tick rather than on a fixed timer.
    if (recordingHex.current && meta.current?.kind === "geofence") {
      const user = userPosRef.current;
      const ac = aircraftRef.current.find((a) => a.ac.hex === recordingHex.current)?.ac;
      if (!user || !stillInFence(user, fenceRadiusRef.current, ac, fieldElevRef.current)) {
        void finish.current();
      }
      return;
    }

    if (recordingHex.current || recorder.isRecording) return;

    const notRecent = (hex: string) => {
      const t = recentlyRecorded.current.get(hex);
      return !(t && Date.now() - t < DEDUPE_MS);
    };
    const start = (m: NoiseMeta, durMs: number) => {
      const ac = aircraftRef.current.find((a) => a.ac.hex === m.hex)?.ac;
      if (ac) m.snapshot = snapshotAircraft(ac);
      recordingHex.current = m.hex;
      meta.current = m;
      recorderRef.current.startRecording();
      setActiveCallsign(m.callsign);
      stopTimer.current = setTimeout(() => void finish.current(), durMs);
    };

    // Priority 0: an aircraft inside the observer's geofence (nearest, low enough).
    const user = userPosRef.current;
    if (user && fenceRadiusRef.current > 0) {
      const inside = insideFence(
        user,
        fenceRadiusRef.current,
        aircraftRef.current.map((w) => w.ac),
        fieldElevRef.current,
      );
      const hit = inside.find((i) => notRecent(i.hex));
      if (hit) {
        const w = aircraftRef.current.find((a) => a.ac.hex === hit.hex);
        start(
          {
            hex: hit.hex,
            callsign: w?.ac.flight ?? hit.hex.toUpperCase(),
            end: w?.assignment?.end ?? "",
            kind: "geofence",
            geofenceRadiusM: fenceRadiusRef.current,
          },
          GEOFENCE_MAX_MS,
        );
        return;
      }
    }

    // Priority 1: a takeoff roll happening right now.
    const roll = departuresRef.current.find(
      (d) => d.phase === "roll" && notRecent(d.hex),
    );
    if (roll) {
      start(
        {
          hex: roll.hex,
          callsign: roll.callsign,
          end: roll.end,
          kind: "departure",
          heldMs: roll.waitedMs,
        },
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
