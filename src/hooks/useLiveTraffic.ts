import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

// Stable identities for the pre-data case so memoized consumers don't churn.
const EMPTY_AIRCRAFT: AircraftWithAssignment[] = [];
const EMPTY_ARRIVALS: Arrival[] = [];
const EMPTY_DEPARTURES: DepartureEvent[] = [];

export interface LiveTraffic {
  aircraft: AircraftWithAssignment[];
  arrivals: Arrival[];
  departures: DepartureEvent[];
  counts: Record<string, number>;
  provider: string | null;
  lastUpdated: number | null;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  refetch: () => void;
}

export function useLiveTraffic(settings: Settings, airport: Airport): LiveTraffic {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const prevGs = useRef(new Map<string, number>());
  const holdingSince = useRef(new Map<string, number>());
  const depMemory = useRef(new Map<string, DepartureMemory>());
  const gateCrossings = useRef<GateCrossings>(new Map());
  const landingMemory: { current: Parameters<typeof trackLandings>[2] } = useRef(new Map());

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
        detectDepartures(airport, snap.aircraft, prevGs.current),
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

      const needsFastPoll =
        departures.some((d) => d.phase === "holding" || d.phase === "roll") ||
        arrivals.some((a) => a.etaSeconds < FAST_ARRIVAL_S);

      return { snap, withAssignment, counts: freshCounts, arrivals, departures, needsFastPoll };
    },
    refetchInterval: (query) => {
      if (query.state.data?.needsFastPoll) return FAST_POLL_MS;
      return Math.max(10, settings.pollSeconds) * 1000;
    },
    refetchOnWindowFocus: false,
    staleTime: 3_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data) setCounts(query.data.counts);
  }, [query.data]);

  return {
    aircraft: query.data?.withAssignment ?? EMPTY_AIRCRAFT,
    arrivals: query.data?.arrivals ?? EMPTY_ARRIVALS,
    departures: query.data?.departures ?? EMPTY_DEPARTURES,
    counts,
    provider: query.data?.snap.provider ?? null,
    lastUpdated: query.data?.snap.fetchedAt ?? null,
    isError: query.isError,
    error: (query.error as Error) ?? null,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
}
