import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchAircraftNearZrh, type Aircraft } from "../data/adsb";
import { assignRunway, type RunwayAssignment } from "../domain/assignRunway";
import {
  countsByEnd,
  loadObservations,
  pruneObservations,
  recordSnapshot,
} from "../domain/observations";
import type { Settings } from "./useSettings";

export interface AircraftWithAssignment {
  ac: Aircraft;
  assignment: RunwayAssignment | null;
}

// Stable identity for the pre-data case so the memoized map doesn't re-render
// every second (App's 1 s clock) before the first poll arrives.
const EMPTY_AIRCRAFT: AircraftWithAssignment[] = [];

export interface LiveTraffic {
  aircraft: AircraftWithAssignment[];
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
      return { snap, withAssignment, counts: fresh };
    },
    refetchInterval: Math.max(10, settings.pollSeconds) * 1000,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data) setCounts(query.data.counts);
  }, [query.data]);

  return {
    aircraft: query.data?.withAssignment ?? EMPTY_AIRCRAFT,
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
