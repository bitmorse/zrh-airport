import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import { fetchTrackedAircraft } from "../data/flightQuery";
import { useFlightRoute } from "./useFlightRoute";

/** searching = not found yet; following = live; lost = was live, now off the feed. */
export type FollowStatus = "searching" | "following" | "lost";

export interface TrackedFlight {
  aircraft: Aircraft | null;
  /** Broadcast (ICAO) callsign we matched, for the readout + shareable link. */
  callsign: string | null;
  route: FlightRoute | null;
  status: FollowStatus;
  lastUpdated: number | null;
  error: Error | null;
}

// One aircraft is cheap to poll a little faster than the whole airport feed.
const FOLLOW_POLL_MS = 6000;

/**
 * Follow a single flight globally by callsign / registration / hex. Polls the global
 * lookup, resolves its airline + route (adsbdb, via {@link useFlightRoute}), and reports
 * a follow status. Keeps polling while `lost`/`searching`, so a link opened before the
 * plane is airborne picks it up once it starts broadcasting.
 */
export function useTrackedFlight(query: string | null): TrackedFlight {
  const q = useQuery({
    queryKey: ["track", query],
    queryFn: ({ signal }) => fetchTrackedAircraft(query!, signal),
    enabled: !!query,
    refetchInterval: FOLLOW_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: FOLLOW_POLL_MS / 2,
    retry: 1,
  });

  const aircraft = q.data?.aircraft ?? null;
  const callsign = q.data?.callsign ?? null;

  // Route works even while searching (adsbdb resolves the raw query), so the panel can
  // show airline + origin→dest before the aircraft itself is found.
  const route = useFlightRoute(callsign ?? query).data ?? null;

  // Distinguish "never found" (searching) from "was following, dropped out" (lost).
  const everFound = useRef(false);
  useEffect(() => {
    everFound.current = false;
  }, [query]);
  if (aircraft) everFound.current = true;

  const status: FollowStatus = aircraft ? "following" : everFound.current ? "lost" : "searching";

  return {
    aircraft,
    callsign,
    route,
    status,
    lastUpdated: aircraft ? q.dataUpdatedAt : null,
    error: (q.error as Error) ?? null,
  };
}
