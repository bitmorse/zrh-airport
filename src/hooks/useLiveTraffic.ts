import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAircraftNear, type Aircraft } from "../data/adsb";
import type { Airport } from "../domain/airport";
import { assignRunway, type RunwayAssignment } from "../domain/assignRunway";
import {
  detectDepartures,
  gsSnapshot,
  trackDepartures,
  trackHolding,
  type DepartureEvent,
  type DepartureMemory,
} from "../domain/departures";
import { detectMovements, type Movement } from "../domain/movements";
import type { TrailPoint } from "../data/watchStore";
import {
  loadMovementLog,
  recordMovements,
  type MovementLog,
} from "../domain/movementStats";
import {
  countsByEnd,
  loadObservations,
  pruneObservations,
  recordSnapshot,
} from "../domain/observations";
import {
  predictArrivals,
  recentGate,
  trackApproachGates,
  trackLandings,
  type Arrival,
  type GateCrossings,
} from "../domain/predictions";
import type { Settings } from "./useSettings";

export interface AircraftWithAssignment {
  ac: Aircraft;
  assignment: RunwayAssignment | null;
}

// Adaptive polling: burst when a departure/arrival is imminent near a threshold.
const FAST_POLL_MS = 4000;
const FAST_ARRIVAL_S = 45;

// Per-aircraft position history (drawn as the selected flight's trajectory).
const TRAIL_MAX_POINTS = 240;
const TRAIL_TTL_MS = 3 * 60 * 1000; // forget a plane's trail 3 min after it's gone

// Stable identities for the pre-data case so memoized consumers don't churn.
const EMPTY_AIRCRAFT: AircraftWithAssignment[] = [];
const EMPTY_ARRIVALS: Arrival[] = [];
const EMPTY_DEPARTURES: DepartureEvent[] = [];
const EMPTY_TRAIL: TrailPoint[] = [];
const EMPTY_MOVEMENTS: Movement[] = [];

interface Trail {
  points: TrailPoint[];
  lastSeen: number;
}

export interface LiveTraffic {
  aircraft: AircraftWithAssignment[];
  arrivals: Arrival[];
  departures: DepartureEvent[];
  counts: Record<string, number>;
  provider: string | null;
  lastUpdated: number | null;
  /** Every provider was behind this poll — positions are delayed (lastUpdated still advances). */
  stale: boolean;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  refetch: () => void;
  /** Recent position history for an aircraft (its trajectory), oldest → newest. */
  trailFor: (hex: string) => TrailPoint[];
  /** Per-airport landing/takeoff history, bucketed by local hour-of-day. */
  movementLog: MovementLog;
  /** Discrete landing/takeoff events detected this poll (stable [] when none). */
  newMovements: Movement[];
}

export function useLiveTraffic(settings: Settings, airport: Airport): LiveTraffic {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const prevGs = useRef(new Map<string, number>());
  const holdingSince = useRef(new Map<string, number>());
  const depMemory = useRef(new Map<string, DepartureMemory>());
  const gateCrossings = useRef<GateCrossings>(new Map());
  const landingMemory: { current: Parameters<typeof trackLandings>[2] } = useRef(new Map());
  const trails = useRef(new Map<string, Trail>());
  const [movementLog, setMovementLog] = useState<MovementLog>({});
  const countedMovements = useRef(new Map<string, number>());

  // Seed counts from any persisted window on mount so the map isn't blank after
  // a reload within the 15-minute window.
  useEffect(() => {
    let alive = true;
    loadObservations().then((obs) => {
      if (alive) setCounts(countsByEnd(pruneObservations(obs, Date.now())));
    });
    return () => {
      alive = false;
    };
  }, []);

  // Load (and on airport switch, reload) this airport's movement history; reset the
  // per-aircraft de-dup memory so counts can't carry across airports.
  useEffect(() => {
    let alive = true;
    countedMovements.current.clear();
    setMovementLog({});
    loadMovementLog(airport.config.icao).then((log) => {
      if (alive) setMovementLog(log);
    });
    return () => {
      alive = false;
    };
  }, [airport.config.icao]);

  const query = useQuery({
    queryKey: ["adsb", airport.config.icao, settings.radiusNm, settings.provider],
    queryFn: async ({ signal }) => {
      const snap = await fetchAircraftNear(
        airport.config.arp,
        settings.radiusNm,
        settings.provider ?? undefined,
        signal,
      );
      const withAssignment: AircraftWithAssignment[] = snap.aircraft.map(
        (ac) => ({ ac, assignment: assignRunway(airport, ac) }),
      );
      const assignments = withAssignment
        .filter((w) => w.assignment)
        .map((w) => ({ hex: w.ac.hex, end: w.assignment!.end }));
      const { counts: freshCounts } = await recordSnapshot(assignments, snap.fetchedAt);

      const freshArrivals = predictArrivals(withAssignment);
      // Stamp when each inbound crosses the approach gates (stabilise, decision height).
      trackApproachGates(
        withAssignment,
        gateCrossings.current,
        airport.config.fieldElevationFt,
        airport.config.geoidFt ?? 0,
        snap.fetchedAt,
      );
      for (const a of freshArrivals) {
        // Carry the latest recent gate; the UI applies the short flash window vs. `now`.
        a.flash = recentGate(gateCrossings.current, a.hex, snap.fetchedAt, 30000);
      }
      // Keep a just-landed aircraft labelled "landing" through its rollout.
      const arrivals = trackLandings(
        freshArrivals,
        withAssignment,
        landingMemory.current,
        snap.fetchedAt,
      );
      // Track each departure as one continuous row (wait → roll → climb, until it
      // climbs past 1000 ft AGL), then stamp/track holding on that smoothed set.
      const tracked = trackDepartures(
        // Pass the prior poll's holders so a plane that was waiting at the threshold
        // is called "roll" the instant it starts moving (holdingSince is updated at
        // the end of the poll, so it still reflects poll N-1 here).
        detectDepartures(
          airport,
          snap.aircraft,
          prevGs.current,
          new Set(holdingSince.current.keys()),
        ),
        snap.aircraft,
        depMemory.current,
        airport.config.fieldElevationFt,
        snap.fetchedAt,
      );
      const departures = trackHolding(
        tracked,
        new Set(tracked.map((d) => d.hex)),
        holdingSince.current,
        snap.fetchedAt,
      );
      prevGs.current = gsSnapshot(snap.aircraft);

      // Count discrete landings/takeoffs and fold them into the local hour-of-day
      // history. Only touch storage when something actually happened.
      const newMovements = detectMovements(
        arrivals,
        departures,
        countedMovements.current,
        snap.fetchedAt,
      );
      const movementLog =
        newMovements.length > 0
          ? await recordMovements(
              airport.config.icao,
              newMovements,
              airport.config.timeZone,
              snap.fetchedAt,
            )
          : null;

      // Append each aircraft's position (with altitude + time) to its trajectory
      // history; forget old ones. The trajectory is what the gamification snapshots.
      for (const ac of snap.aircraft) {
        const t = trails.current.get(ac.hex) ?? { points: [], lastSeen: 0 };
        t.points.push({
          lat: ac.lat,
          lon: ac.lon,
          alt: ac.altGeomFt ?? ac.altFt,
          t: snap.fetchedAt,
        });
        if (t.points.length > TRAIL_MAX_POINTS) t.points.shift();
        t.lastSeen = snap.fetchedAt;
        trails.current.set(ac.hex, t);
      }
      for (const [hex, t] of trails.current) {
        if (snap.fetchedAt - t.lastSeen > TRAIL_TTL_MS) trails.current.delete(hex);
      }

      const needsFastPoll =
        departures.some((d) => d.phase === "holding" || d.phase === "roll") ||
        arrivals.some((a) => a.etaSeconds < FAST_ARRIVAL_S);

      return {
        snap,
        withAssignment,
        counts: freshCounts,
        arrivals,
        departures,
        movementLog,
        // Stable empty ref between events so movement-driven effects don't refire.
        newMovements: newMovements.length ? newMovements : EMPTY_MOVEMENTS,
        needsFastPoll,
      };
    },
    refetchInterval: (query) => {
      if (query.state.data?.needsFastPoll) return FAST_POLL_MS;
      return Math.max(10, settings.pollSeconds) * 1000;
    },
    // Refetch immediately when the tab is refocused/revealed (the interval is paused
    // while hidden, so otherwise you'd stare at stale data until the next tick).
    // `staleTime` keeps a quick glance-away-and-back from firing a redundant fetch.
    refetchOnWindowFocus: true,
    staleTime: 3_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data) setCounts(query.data.counts);
    if (query.data?.movementLog) setMovementLog(query.data.movementLog);
  }, [query.data]);

  const trailFor = useCallback(
    (hex: string) => trails.current.get(hex)?.points ?? EMPTY_TRAIL,
    [],
  );

  return {
    aircraft: query.data?.withAssignment ?? EMPTY_AIRCRAFT,
    arrivals: query.data?.arrivals ?? EMPTY_ARRIVALS,
    departures: query.data?.departures ?? EMPTY_DEPARTURES,
    counts,
    provider: query.data?.snap.provider ?? null,
    lastUpdated: query.data?.snap.fetchedAt ?? null,
    /** Every provider was behind — positions are delayed even though lastUpdated advances. */
    stale: query.data?.snap.stale ?? false,
    isError: query.isError,
    error: (query.error as Error) ?? null,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
    trailFor,
    movementLog,
    newMovements: query.data?.newMovements ?? EMPTY_MOVEMENTS,
  };
}
