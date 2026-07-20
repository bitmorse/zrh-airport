import { useQuery } from "@tanstack/react-query";
import {
  fetchAirportMovements,
  STATS_MAX_DAYS,
  type AirportMovements,
} from "../data/airportStats";

/**
 * Server-collected movement history for an airport, from the backend stats API.
 * Fetched on demand and cached (the API is cacheable for ~5 min) — no poll loop,
 * per the API guidance. Falls back gracefully in the UI to on-device history when
 * the server is unreachable.
 */
export function useAirportStats(icao: string, days = STATS_MAX_DAYS) {
  return useQuery<AirportMovements>({
    queryKey: ["airportStats", icao, days],
    queryFn: ({ signal }) => fetchAirportMovements(icao, days, signal),
    enabled: !!icao,
    staleTime: 5 * 60_000, // matches the API's Cache-Control: max-age=300
    gcTime: 60 * 60_000,
    refetchInterval: false, // on demand, not a poll loop
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
