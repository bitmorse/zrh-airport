import { useQuery } from "@tanstack/react-query";
import { fetchAirportRecent, type AirportRecent } from "../data/airportStats";

/**
 * Per-runway-end movements in the recent window (backend `/recent`), for the live map
 * heatmap. Polled so "right now" stays current; the API caches it for ~60 s. The UI
 * falls back to on-device / current-hour counts when the server is unreachable or the
 * endpoint isn't deployed yet.
 */
export function useAirportRecent(icao: string, minutes = 90) {
  return useQuery<AirportRecent>({
    queryKey: ["airportRecent", icao, minutes],
    queryFn: ({ signal }) => fetchAirportRecent(icao, minutes, signal),
    enabled: !!icao,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
