import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchAircraftNearZrh, type Aircraft } from "../data/adsb";
import { assignRunway, type RunwayAssignment } from "../domain/assignRunway";
import {
  detectDepartures,
  gsSnapshot,
  trackHolding,
  type DepartureEvent,
} from "../domain/departures";
import {
  countsByEnd,
  loadObservations,
  pruneObservations,
  recordSnapshot,
} from "../domain/observations";
import { predictArrivals, type Arrival } from "../domain/predictions";
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

export function useLiveTraffic(settings: Settings): LiveTraffic {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const prevGs = useRef(new Map<string, number>());
  const holdingSince = useRef(new Map<string, number>());

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
    queryKey: ["adsb", settings.radiusNm, settings.provider],
    queryFn: async ({ signal }) => {
      const snap = await fetchAircraftNearZrh(
        settings.radiusNm,
        settings.provider ?? undefined,
        signal,
      );
      const withAssignment: AircraftWithAssignment[] = snap.aircraft.map(
        (ac) => ({ ac, assignment: assignRunway(ac) }),
      );
      const assignments = withAssignment
        .filter((w) => w.assignment)
        .map((w) => ({ hex: w.ac.hex, end: w.assignment!.end }));
      const { counts: fresh } = await recordSnapshot(assignments, snap.fetchedAt);

      const arrivals = predictArrivals(withAssignment);
      const departures = trackHolding(
        detectDepartures(snap.aircraft, prevGs.current),
        new Set(snap.aircraft.map((a) => a.hex)),
        holdingSince.current,
        snap.fetchedAt,
      );
      prevGs.current = gsSnapshot(snap.aircraft);

      const needsFastPoll =
        departures.some((d) => d.phase === "holding" || d.phase === "roll") ||
        arrivals.some((a) => a.etaSeconds < FAST_ARRIVAL_S);

      return { snap, withAssignment, counts: fresh, arrivals, departures, needsFastPoll };
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
