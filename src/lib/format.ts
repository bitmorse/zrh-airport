import type { FlightRoute } from "../data/flightInfo";

/** Seconds → "m:ss" countdown, or "landing" when essentially at the threshold. */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total <= 5) return "landing";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "Swiss LX22 · LHR→ZRH" from a looked-up route, or null. */
export function routeText(r: FlightRoute | null | undefined): string | null {
  if (!r) return null;
  const orig = r.origin?.iata ?? r.origin?.icao ?? "?";
  const dest = r.destination?.iata ?? r.destination?.icao ?? "ZRH";
  const airline = [r.airlineName, r.flightIata].filter(Boolean).join(" ");
  return [airline, `${orig}→${dest}`].filter(Boolean).join(" · ");
}
