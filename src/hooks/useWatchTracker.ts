import { useEffect, useRef } from "react";
import { getNoiseSnapshot } from "../data/noiseStore";
import { addWatch, type TrailPoint, type WatchedFlight } from "../data/watchStore";
import type { Movement } from "../domain/movements";
import type { AircraftWithAssignment } from "./useLiveTraffic";

/** A GPS-tagged recording within this window of completion earns the flight double. */
const GPS_AUDIO_WINDOW_MS = 10 * 60 * 1000;

/**
 * Gamification: when a landing/takeoff completes for the aircraft the user has
 * *currently selected*, record it as a "watched flight" (with its captured
 * trajectory) — worth double points if a GPS-tagged audio clip exists for it. Reads
 * selection/aircraft/trail via refs so it only reacts to new movement events.
 */
export function useWatchTracker(opts: {
  newMovements: Movement[];
  selectedHex: string | null;
  aircraft: AircraftWithAssignment[];
  trailFor: (hex: string) => TrailPoint[];
}) {
  const selectedRef = useRef(opts.selectedHex);
  selectedRef.current = opts.selectedHex;
  const aircraftRef = useRef(opts.aircraft);
  aircraftRef.current = opts.aircraft;
  const trailForRef = useRef(opts.trailFor);
  trailForRef.current = opts.trailFor;

  const { newMovements } = opts;
  useEffect(() => {
    for (const m of newMovements) {
      if (m.hex !== selectedRef.current) continue;
      const ac = aircraftRef.current.find((a) => a.ac.hex === m.hex)?.ac;
      const hadGpsAudio = getNoiseSnapshot().some(
        (e) =>
          e.hex === m.hex &&
          e.lat != null &&
          e.lon != null &&
          Math.abs(m.ts - e.startedAt) <= GPS_AUDIO_WINDOW_MS,
      );
      const w: WatchedFlight = {
        id: crypto.randomUUID(),
        hex: m.hex,
        callsign: ac?.flight ?? null,
        type: ac?.type ?? null,
        registration: ac?.registration ?? null,
        kind: m.kind,
        end: m.end || null,
        completedAt: m.ts,
        points: hadGpsAudio ? 2 : 1,
        hadGpsAudio,
        trajectory: trailForRef.current(m.hex).map((p) => ({ ...p })),
      };
      void addWatch(w);
    }
  }, [newMovements]);
}
