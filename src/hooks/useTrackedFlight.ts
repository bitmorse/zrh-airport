import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import { fetchTrackedAircraft, normalizeQuery } from "../data/flightQuery";
import { useFlightRoute } from "./useFlightRoute";

/** Where the shown position comes from: a live fix, this session's last fix, or a guess. */
export type PositionSource = "live" | "last-seen" | "origin";

export interface TrackedFlight {
  /** The aircraft to show — a live fix, the last one we saw, or a synthetic guess at the
   *  origin. Null only while we're still resolving and have nothing to place yet. */
  aircraft: Aircraft | null;
  /** Broadcast (ICAO) callsign we matched, for the readout + shareable link. */
  callsign: string | null;
  route: FlightRoute | null;
  /** How `aircraft`'s position was obtained (null while searching with nothing to show). */
  positionSource: PositionSource | null;
  /** When we last had a *live* fix (for a "last seen 3 min ago" note); null if never. */
  lastLiveAt: number | null;
  /** When the shown data was last refreshed. */
  lastUpdated: number | null;
  error: Error | null;
}

// One aircraft is cheap to poll a little faster than the whole airport feed.
const FOLLOW_POLL_MS = 6000;

/** A synthetic "not airborne yet" aircraft parked at its route origin — the best guess
 *  when a flight isn't broadcasting and we've never seen it this session. */
function originAircraft(query: string, callsign: string | null, route: FlightRoute): Aircraft | null {
  const o = route.origin;
  if (!o || o.lat == null || o.lon == null) return null;
  return {
    // A stable synthetic id, distinct from any real ICAO hex (which are 6 hex chars).
    hex: `est-${normalizeQuery(callsign ?? query)}`,
    flight: callsign ?? normalizeQuery(query),
    lat: o.lat,
    lon: o.lon,
    altFt: null,
    altGeomFt: null,
    onGround: true,
    gs: null,
    track: null,
    verticalRateFpm: null,
    seenPos: null,
    type: null,
    typeDesc: null,
    registration: null,
  };
}

/**
 * Resolve a single flight globally (by callsign / registration / hex / flight number) and
 * keep it fresh. Returns the aircraft to place on the map plus where its position came
 * from: a **live** fix when it's broadcasting; otherwise its **last-seen** position from
 * earlier this session; otherwise a best-guess at the route **origin** (from adsbdb). Keeps
 * polling, so a plane searched before it's airborne snaps to live the moment it appears.
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

  const live = q.data?.aircraft ?? null;
  const callsign = q.data?.callsign ?? null;

  // Route works even while searching (adsbdb resolves the raw query), so we can show the
  // airline + origin→dest — and place an origin best-guess — before the plane is found.
  const route = useFlightRoute(callsign ?? query).data ?? null;

  // Remember the last live fix for this query, so a plane that drops off the feed stays
  // pinned where we last saw it (marked stale) instead of vanishing.
  const lastSeen = useRef<{ ac: Aircraft; at: number } | null>(null);
  useEffect(() => {
    lastSeen.current = null; // new query → forget the previous flight's last position
  }, [query]);
  if (live) lastSeen.current = { ac: live, at: q.dataUpdatedAt };

  let aircraft: Aircraft | null = null;
  let positionSource: PositionSource | null = null;
  if (live) {
    aircraft = live;
    positionSource = "live";
  } else if (lastSeen.current) {
    aircraft = lastSeen.current.ac;
    positionSource = "last-seen";
  } else if (route) {
    const guess = originAircraft(query ?? "", callsign, route);
    if (guess) {
      aircraft = guess;
      positionSource = "origin";
    }
  }

  return {
    aircraft,
    callsign,
    route,
    positionSource,
    lastLiveAt: lastSeen.current?.at ?? null,
    lastUpdated: q.dataUpdatedAt || null,
    error: (q.error as Error) ?? null,
  };
}
