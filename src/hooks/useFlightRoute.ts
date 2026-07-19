import { useQuery } from "@tanstack/react-query";
import { fetchFlightRoute, type FlightRoute } from "../data/flightInfo";

/**
 * Look up a callsign's airline + origin/destination via adsbdb, cached for the
 * day. Disabled when there's no callsign. Shared by the flight-details card, the
 * arrivals board and the mobile next-landing bar (React Query dedupes by key).
 */
export function useFlightRoute(callsign: string | null) {
  return useQuery<FlightRoute | null>({
    queryKey: ["route", callsign],
    queryFn: ({ signal }) => fetchFlightRoute(callsign!, signal),
    enabled: !!callsign,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    retry: 1,
  });
}
