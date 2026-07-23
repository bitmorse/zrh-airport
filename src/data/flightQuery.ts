import { fetchAircraftByLookup, type Aircraft, type LookupKind } from "./adsb";
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
 *
 * A dashless token is genuinely ambiguous — an ICAO callsign ("RYR1TZ", "SWR9YH") and a
 * registration ("N123AB") both look like letters·digits·letters — and the map labels
 * planes with their *callsign*, which is what users copy in. So rather than commit to one
 * endpoint from a guess, we probe the likely endpoints in order and take the first hit.
 */
export async function fetchTrackedAircraft(
  raw: string,
  signal?: AbortSignal,
): Promise<TrackedResult | null> {
  const q = normalizeQuery(raw);
  if (!q) return null;

  // Look one endpoint up and return a result if the match is real. For callsign lookups
  // the provider already filters server-side, but pickByCallsign guards the odd feed that
  // returns extras; reg/hex lookups return the single tail/airframe.
  const probe = async (kind: LookupKind, value: string): Promise<TrackedResult | null> => {
    const list = await fetchAircraftByLookup(kind, value, signal);
    const ac = kind === "callsign" ? pickByCallsign(list, normalizeQuery(value)) : (list[0] ?? null);
    return ac ? { aircraft: ac, callsign: ac.flight?.trim() ?? value } : null;
  };

  // ICAO hex is unambiguous (exactly six hex chars).
  if (classifyQuery(raw) === "hex") return probe("hex", q);

  // A dash means it's unambiguously a registration (HB-JCA, D-AIMA). Try the tail, then
  // fall back to a callsign match in case the airframe isn't in the provider's tail DB.
  if (raw.includes("-")) return (await probe("reg", q)) ?? (await probe("callsign", q));

  // Dashless: try the callsign as typed first — that's the label shown on the map
  // (RYR1TZ, SWR40, SWR9YH). This is the common case and usually resolves immediately.
  const direct = await probe("callsign", q);
  if (direct) return direct;

  // Not the broadcast callsign itself — maybe an IATA flight number. adsbdb bridges it to
  // the ICAO callsign that ADS-B actually carries (AI136 → airline AIC → AIC136).
  const route = await fetchFlightRoute(q, signal).catch(() => null);
  const digits = q.replace(/^[A-Z]+/i, "");
  if (route?.airlineIcao && digits) {
    const viaRoute = await probe("callsign", route.airlineIcao + digits);
    if (viaRoute) return viaRoute;
  }

  // Last resort: a dashless registration (US N-numbers carry no dash).
  return probe("reg", q);
}
