import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import { classifyQuery, fetchTrackedAircraft, normalizeQuery } from "../data/flightQuery";
import {
  fetchFlightLookup,
  fetchFlightPosition,
  type FlightLookup,
  type FlightPosition,
} from "../data/flightLookup";
import { useFlightRoute } from "./useFlightRoute";

/** Where the shown position comes from: our live ADS-B, the paid AeroAPI lookup (an
 *  off-radar fix), this session's last ADS-B fix, or a guess at the route origin. */
export type PositionSource = "live" | "lookup" | "last-seen" | "origin";

export interface TrackedFlight {
  /** The aircraft to show — a live fix, an AeroAPI fix, the last one we saw, or a guess.
   *  Null only while resolving with nothing to place yet. */
  aircraft: Aircraft | null;
  /** Broadcast (ICAO) callsign we matched, for the readout + shareable link. */
  callsign: string | null;
  route: FlightRoute | null;
  /** Rich on-request enrichment (gate / status / scheduled times), when available. */
  lookup: FlightLookup | null;
  /** How `aircraft`'s position was obtained (null while searching with nothing to show). */
  positionSource: PositionSource | null;
  /** When we last had a *live* ADS-B fix (for a "last seen 3 min ago" note); null if never. */
  lastLiveAt: number | null;
  lastUpdated: number | null;
  error: Error | null;
}

// One aircraft is cheap to poll a little faster than the whole airport feed.
const FOLLOW_POLL_MS = 6000;

/** A synthetic "not airborne yet" aircraft parked at its route origin — the last-resort
 *  guess when a flight isn't broadcasting and AeroAPI has no fix either. */
function originAircraft(query: string, callsign: string | null, route: FlightRoute): Aircraft | null {
  const o = route.origin;
  if (!o || o.lat == null || o.lon == null) return null;
  return synthetic(callsign ?? normalizeQuery(query), o.lat, o.lon, { onGround: true });
}

/** An aircraft built from an AeroAPI position fix (off our ADS-B radar). */
function aircraftFromPosition(pos: FlightPosition | null, ident: string): Aircraft | null {
  if (!pos || pos.lat == null || pos.lon == null) return null;
  const onGround = pos.updateType === "X" || (pos.altitude != null && pos.altitude <= 0);
  return synthetic(pos.ident ?? ident, pos.lat, pos.lon, {
    onGround,
    // AeroAPI altitude is in hundreds of feet / flight level — ×100 for feet.
    altFt: pos.altitude != null ? pos.altitude * 100 : null,
    gs: pos.groundspeed,
    track: pos.heading,
    type: pos.aircraftType,
  });
}

/** A synthetic Aircraft with a non-hex id, so it never collides with a real ICAO hex. */
function synthetic(ident: string, lat: number, lon: number, over: Partial<Aircraft>): Aircraft {
  return {
    hex: `est-${normalizeQuery(ident)}`,
    flight: ident,
    lat,
    lon,
    altFt: null,
    altGeomFt: null,
    onGround: false,
    gs: null,
    track: null,
    verticalRateFpm: null,
    seenPos: null,
    type: null,
    typeDesc: null,
    registration: null,
    ...over,
  };
}

/** The designator to look up on AeroAPI: the resolved callsign, else a flight-number query. */
function lookupIdent(query: string | null, callsign: string | null): string | null {
  if (callsign) return callsign;
  return query && classifyQuery(query) === "flight" ? normalizeQuery(query) : null;
}

/**
 * Resolve a single flight globally and keep it fresh. Position, in priority order: our
 * **live** ADS-B fix; else this session's **last-seen** ADS-B fix; else a paid AeroAPI
 * **lookup** fix (for a flight off our radar — parked or out of range); else a best-guess
 * at the route **origin**. The AeroAPI calls are paid, so they fire *only* when our ADS-B
 * came up empty (never for a broadcasting flight, never on the 6 s poll) — one call each,
 * cached, no auto-retry — and only exist because the user explicitly searched.
 */
export function useTrackedFlight(query: string | null): TrackedFlight {
  // Free ADS-B lookup, polled while following.
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

  // Free route (airline + origin→dest, with coords) — works even while searching.
  const route = useFlightRoute(callsign ?? query).data ?? null;

  // Remember the last live ADS-B fix, so a plane that drops off stays pinned (stale).
  const lastSeen = useRef<{ ac: Aircraft; at: number } | null>(null);
  useEffect(() => {
    lastSeen.current = null;
  }, [query]);
  if (live) lastSeen.current = { ac: live, at: q.dataUpdatedAt };
  const hasLastSeen = lastSeen.current != null;

  // Paid AeroAPI enrichment — one-shot, no poll. Enabled only once the ADS-B lookup has
  // settled without a live fix (so a broadcasting flight never triggers a billed call).
  const ident = lookupIdent(query, callsign);
  const lookupQ = useQuery({
    queryKey: ["flightLookup", ident],
    queryFn: ({ signal }) => fetchFlightLookup(ident!, signal),
    enabled: !!ident && q.isFetched && !live,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  const lookup = lookupQ.data ?? null;

  // Paid position — only to pin an off-radar flight we have no ADS-B fix for at all.
  const faId = lookup?.faFlightId ?? null;
  const posQ = useQuery({
    queryKey: ["flightPosition", faId],
    queryFn: ({ signal }) => fetchFlightPosition(faId!, signal),
    enabled: !!faId && !live && !hasLastSeen,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  let aircraft: Aircraft | null = null;
  let positionSource: PositionSource | null = null;
  if (live) {
    aircraft = live;
    positionSource = "live";
  } else if (lastSeen.current) {
    aircraft = lastSeen.current.ac;
    positionSource = "last-seen";
  } else {
    const fromLookup = aircraftFromPosition(posQ.data ?? null, ident ?? query ?? "");
    if (fromLookup) {
      aircraft = fromLookup;
      positionSource = "lookup";
    } else if (route) {
      const guess = originAircraft(query ?? "", callsign, route);
      if (guess) {
        aircraft = guess;
        positionSource = "origin";
      }
    }
  }

  return {
    aircraft,
    callsign,
    route,
    lookup,
    positionSource,
    lastLiveAt: lastSeen.current?.at ?? null,
    lastUpdated: q.dataUpdatedAt || null,
    error: (q.error as Error) ?? null,
  };
}
