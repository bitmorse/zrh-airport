/**
 * On-request flight enrichment from FlightAware AeroAPI, proxied through our backend so
 * the API key never reaches the browser (see backend/api.md → GET /flight/{ident} and
 * /flight/{faFlightId}/position, and docs/flight-lookup-frontend.md).
 *
 * ⚠️ This is a **paid** upstream, billed per call. Only call on an explicit user action
 * (a search submit) — never on hover, render, selection, or a poll loop. The backend
 * caches + caps per day; the frontend must not spam it. We use it to place a searched
 * flight the local ADS-B radar can't see (parked at the gate, or just out of range) and
 * to enrich the card with gate / status / scheduled times.
 */
import { STATS_BASE_URL } from "./airportStats";

/** A designator: an ICAO callsign or flight number, 2–12 alphanumerics (e.g. SWR72, LX72). */
export const IDENT_RE = /^[A-Za-z0-9]{2,12}$/;

export interface FlightEndpoint {
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
}

export interface FlightLookup {
  faFlightId: string | null;
  ident: string | null;
  identIcao: string | null;
  identIata: string | null;
  registration: string | null;
  aircraftType: string | null;
  operator: string | null;
  operatorIcao: string | null;
  flightNumber: string | null;
  status: string | null;
  progressPercent: number | null;
  cancelled: boolean;
  diverted: boolean;
  positionOnly: boolean;
  origin: FlightEndpoint | null;
  destination: FlightEndpoint | null;
  gateOrigin: string | null;
  gateDestination: string | null;
  terminalOrigin: string | null;
  terminalDestination: string | null;
  baggageClaim: string | null;
  scheduledOut: string | null;
  estimatedOut: string | null;
  actualOut: string | null;
  scheduledOff: string | null;
  estimatedOff: string | null;
  actualOff: string | null;
  scheduledOn: string | null;
  estimatedOn: string | null;
  actualOn: string | null;
  scheduledIn: string | null;
  estimatedIn: string | null;
  actualIn: string | null;
  departureDelay: number | null;
  arrivalDelay: number | null;
  route: string | null;
  routeDistance: number | null;
  filedAltitude: number | null;
  filedAirspeed: number | null;
}

export interface FlightPosition {
  faFlightId: string | null;
  ident: string | null;
  aircraftType: string | null;
  origin: FlightEndpoint | null;
  destination: FlightEndpoint | null;
  /** WGS84 — feed straight into projectToSvg. Null when there's no live fix (parked). */
  lat: number | null;
  lon: number | null;
  heading: number | null;
  /** AeroAPI convention: **hundreds of feet** / flight level (×100 for feet). */
  altitude: number | null;
  altitudeChange: string | null;
  groundspeed: number | null;
  updateType: string | null; // A=ADS-B, X=surface, Z=radar, …
  timestamp: string | null;
}

/** Distinguishable failure so the UI can tell "at the daily cap" from "provider down". */
export class FlightLookupError extends Error {
  constructor(
    readonly status: number,
    readonly code: "rate-limited" | "provider" | "http",
  ) {
    super(`flight lookup ${status}`);
    this.name = "FlightLookupError";
  }
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean => v === true;

function endpoint(v: unknown): FlightEndpoint | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const e = { icao: str(o.icao), iata: str(o.iata), name: str(o.name), city: str(o.city) };
  return e.icao || e.iata || e.name || e.city ? e : null;
}

/** Map 4xx/5xx to a null (no enrichment) or a typed throw, shared by both calls. */
function handleErrorStatus(status: number): null {
  // 404 (no flight / route not deployed), 400 (bad ident), 501 (no key) → silently
  // unavailable: fall back to the free path, no error UI.
  if (status === 404 || status === 400 || status === 501) return null;
  if (status === 429) throw new FlightLookupError(status, "rate-limited");
  if (status === 502) throw new FlightLookupError(status, "provider");
  throw new FlightLookupError(status, "http");
}

/**
 * Resolve a flight by designator (ICAO callsign or flight number). Returns null when the
 * ident is invalid, no flight matches, or the feature is unavailable (not configured /
 * not deployed) — all non-events that fall back to the free path. Throws only on a
 * transient upstream failure (429/502) so the caller can note it.
 */
export async function fetchFlightLookup(
  ident: string,
  signal?: AbortSignal,
): Promise<FlightLookup | null> {
  const id = ident.trim().toUpperCase();
  if (!IDENT_RE.test(id)) return null;
  const res = await fetch(`${STATS_BASE_URL}/flight/${encodeURIComponent(id)}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return handleErrorStatus(res.status);
  const o = (await res.json()) as Record<string, unknown>;
  return {
    faFlightId: str(o.faFlightId),
    ident: str(o.ident),
    identIcao: str(o.identIcao),
    identIata: str(o.identIata),
    registration: str(o.registration),
    aircraftType: str(o.aircraftType),
    operator: str(o.operator),
    operatorIcao: str(o.operatorIcao),
    flightNumber: str(o.flightNumber),
    status: str(o.status),
    progressPercent: num(o.progressPercent),
    cancelled: bool(o.cancelled),
    diverted: bool(o.diverted),
    positionOnly: bool(o.positionOnly),
    origin: endpoint(o.origin),
    destination: endpoint(o.destination),
    gateOrigin: str(o.gateOrigin),
    gateDestination: str(o.gateDestination),
    terminalOrigin: str(o.terminalOrigin),
    terminalDestination: str(o.terminalDestination),
    baggageClaim: str(o.baggageClaim),
    scheduledOut: str(o.scheduledOut),
    estimatedOut: str(o.estimatedOut),
    actualOut: str(o.actualOut),
    scheduledOff: str(o.scheduledOff),
    estimatedOff: str(o.estimatedOff),
    actualOff: str(o.actualOff),
    scheduledOn: str(o.scheduledOn),
    estimatedOn: str(o.estimatedOn),
    actualOn: str(o.actualOn),
    scheduledIn: str(o.scheduledIn),
    estimatedIn: str(o.estimatedIn),
    actualIn: str(o.actualIn),
    departureDelay: num(o.departureDelay),
    arrivalDelay: num(o.arrivalDelay),
    route: str(o.route),
    routeDistance: num(o.routeDistance),
    filedAltitude: num(o.filedAltitude),
    filedAirspeed: num(o.filedAirspeed),
  };
}

/**
 * Last known position for a flight (by `faFlightId` from {@link fetchFlightLookup}) — to
 * pin a searched flight that isn't in the live feed. Returns null when unavailable; a
 * truly parked jet 200s with null coordinates (identity only, no pin).
 */
export async function fetchFlightPosition(
  faFlightId: string,
  signal?: AbortSignal,
): Promise<FlightPosition | null> {
  const res = await fetch(
    `${STATS_BASE_URL}/flight/${encodeURIComponent(faFlightId)}/position`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) return handleErrorStatus(res.status);
  const o = (await res.json()) as Record<string, unknown>;
  return {
    faFlightId: str(o.faFlightId),
    ident: str(o.ident),
    aircraftType: str(o.aircraftType),
    origin: endpoint(o.origin),
    destination: endpoint(o.destination),
    lat: num(o.lat),
    lon: num(o.lon),
    heading: num(o.heading),
    altitude: num(o.altitude),
    altitudeChange: str(o.altitudeChange),
    groundspeed: num(o.groundspeed),
    updateType: str(o.updateType),
    timestamp: str(o.timestamp),
  };
}
