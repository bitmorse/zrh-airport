import type { FlightRoute } from "../data/flightInfo";

export type Units = "metric" | "imperial";

const NM_TO_KM = 1.852;
const KT_TO_KMH = 1.852;
const FT_TO_M = 0.3048;

/** Distance (nautical miles) → "12.3 km" / "480 m" (metric) or "6.6 NM". */
export function formatDistance(nm: number, units: Units): string {
  if (units === "imperial") return `${nm.toFixed(1)} NM`;
  const km = nm * NM_TO_KM;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Ground speed (knots) → "260 km/h" (metric) or "140 kt". */
export function formatSpeed(kt: number, units: Units): string {
  return units === "imperial"
    ? `${Math.round(kt)} kt`
    : `${Math.round(kt * KT_TO_KMH)} km/h`;
}

/** Altitude (feet) → "1,220 m" (metric) or "4,000 ft". */
export function formatAltitude(ft: number, units: Units): string {
  return units === "imperial"
    ? `${Math.round(ft).toLocaleString()} ft`
    : `${Math.round(ft * FT_TO_M).toLocaleString()} m`;
}

const FPM_TO_MS = 0.00508;

/** Vertical rate (feet/min) → "↑ 8.4 m/s" (metric) or "↑ 1,650 fpm". */
export function formatVerticalRate(fpm: number, units: Units): string {
  const arrow = fpm > 50 ? "↑" : fpm < -50 ? "↓" : "→";
  const mag =
    units === "imperial"
      ? `${Math.abs(Math.round(fpm)).toLocaleString()} fpm`
      : `${Math.abs(fpm * FPM_TO_MS).toFixed(1)} m/s`;
  return `${arrow} ${mag}`;
}

/** Seconds → plain "m:ss" (for elapsed/wait timers). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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

/** Just the endpoints, "LHR→ZRH" — the compact route for a glanceable row. */
export function routePairText(r: FlightRoute | null | undefined): string | null {
  if (!r) return null;
  const orig = r.origin?.iata ?? r.origin?.icao;
  const dest = r.destination?.iata ?? r.destination?.icao;
  if (!orig && !dest) return null;
  return `${orig ?? "?"}→${dest ?? "?"}`;
}
