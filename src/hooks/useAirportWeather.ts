import { useQuery } from "@tanstack/react-query";
import { fetchAirportWeather, type AirportWeather } from "../data/airportWeather";

/**
 * Server-collected hourly weather for the optional wind overlay. Gated by `enabled`
 * so no network request is made unless the overlay is switched on — the whole
 * feature stays off the wire (and off the render path) by default. Source data is
 * hourly, so a ~10-minute refetch is plenty; cached long between polls.
 */
export function useAirportWeather(icao: string, opts: { enabled?: boolean } = {}) {
  return useQuery<AirportWeather>({
    queryKey: ["airportWeather", icao],
    queryFn: ({ signal }) => fetchAirportWeather(icao, 2, signal),
    enabled: !!icao && (opts.enabled ?? false),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
