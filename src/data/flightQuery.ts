import { fetchAircraftByLookup, type Aircraft } from "./adsb";
import { fetchFlightRoute } from "./flightInfo";

/**
 * Resolve a user's free-text flight query — a flight number ("AI 136" / "AIC136"), an
 * aircraft registration ("HB-JCA") or an ICAO hex ("4b1620") — to a live aircraft,
 * looked up globally (not radius-limited). Flight numbers are the tricky case: ADS-B
 * broadcasts the ICAO callsign ("AIC136"), so we run the query through adsbdb to get the
 * airline's ICAO prefix, then match the provider's global callsign feed.
 */

export type QueryKind = "hex" | "reg" | "flight";

const HEX_RE = /^[0-9a-f]{6}$/i;
// A registration has a dash or is letters+digits with a letter late in the string
// (e.g. HB-JCA, N123AB, D-AIMA). A flight number is airline-letters then digits (AI136).
const REG_RE = /-/;
const FLIGHT_RE = /^[a-z]{2,3}\s?\d{1,4}[a-z]?$/i;

/** Normalize for matching/lookup: uppercase, strip spaces and dashes. */
export function normalizeQuery(q: string): string {
  return q.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** Classify what the user typed so we hit the right global endpoint. */
export function classifyQuery(raw: string): QueryKind {
  const q = normalizeQuery(raw);
  if (HEX_RE.test(q)) return "hex";
  if (REG_RE.test(raw) || (!FLIGHT_RE.test(raw.trim()) && /[A-Z].*\d.*[A-Z]/i.test(q))) return "reg";
  return "flight";
}

export interface TrackedResult {
  aircraft: Aircraft;
  /** The ICAO callsign we matched on (for the shareable link + readout). */
  callsign: string | null;
}

/** Pick the aircraft whose callsign best matches the normalized target. */
function pickByCallsign(list: Aircraft[], target: string): Aircraft | null {
  const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s-]/g, "");
  return (
    list.find((a) => norm(a.flight) === target) ??
    list.find((a) => norm(a.flight).startsWith(target)) ??
    list[0] ??
    null
  );
}

/**
 * Resolve a query to a single live aircraft, or null when it isn't broadcasting now.
 * Throws only if the network path is entirely unavailable (all providers error).
 */
export async function fetchTrackedAircraft(
  raw: string,
  signal?: AbortSignal,
): Promise<TrackedResult | null> {
  const kind = classifyQuery(raw);
  const q = normalizeQuery(raw);
  if (!q) return null;

  if (kind === "hex") {
    const ac = (await fetchAircraftByLookup("hex", q, signal))[0];
    return ac ? { aircraft: ac, callsign: ac.flight?.trim() ?? null } : null;
  }

  if (kind === "reg") {
    const ac = (await fetchAircraftByLookup("reg", q, signal))[0];
    return ac ? { aircraft: ac, callsign: ac.flight?.trim() ?? null } : null;
  }

  // Flight number: resolve the ICAO callsign via adsbdb (AI136 → airline AIC → AIC136),
  // then match the global callsign feed. Try the ICAO form first, then the raw query.
  const route = await fetchFlightRoute(q, signal).catch(() => null);
  const digits = q.replace(/^[A-Z]+/i, "");
  const candidates = [
    route?.airlineIcao && digits ? route.airlineIcao + digits : null,
    q,
  ].filter((c): c is string => !!c);

  for (const cs of candidates) {
    const list = await fetchAircraftByLookup("callsign", cs, signal);
    const ac = pickByCallsign(list, normalizeQuery(cs));
    if (ac) return { aircraft: ac, callsign: ac.flight?.trim() ?? cs };
  }
  return null;
}
