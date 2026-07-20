import { useQuery } from "@tanstack/react-query";
import {
  fetchAirportMovements,
  STATS_MAX_DAYS,
  type AirportMovements,
} from "../data/airportStats";

/**
 * Server-collected movement history for an airport, from the backend stats API.
 * Cacheable (~5 min). The "today" window that drives the live heatmap passes a
 * `refetchInterval` so "right now" stays current; the "usual" window is fetched on
 * demand (and can be lazily `enabled`). Falls back in the UI to on-device history
 * when the server is unreachable.
 */
export function useAirportStats(
  icao: string,
  days = STATS_MAX_DAYS,
  opts: { refetchInterval?: number | false; enabled?: boolean; dow?: number | null } = {},
) {
  const refetchInterval = opts.refetchInterval ?? false;
  const dow = opts.dow ?? null;
  return useQuery<AirportMovements>({
    queryKey: ["airportStats", icao, days, dow],
    queryFn: ({ signal }) => fetchAirportMovements(icao, days, signal, dow),
    enabled: !!icao && (opts.enabled ?? true),
    // Keep staleTime under the poll interval so the live window actually refreshes.
    staleTime: refetchInterval ? Math.min(5 * 60_000, refetchInterval) : 5 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
