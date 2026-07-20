/**
 * Sanity-check a looked-up route against what ADS-B actually shows the aircraft
 * doing at our field. adsbdb maps a callsign to one scheduled leg, but crews often
 * don't change the broadcast callsign for the turnaround — so an aircraft departing
 * ZRH can still carry the inbound MAD→ZRH callsign, and the route then reads exactly
 * backwards. We know the live direction, so we can flag the contradiction rather than
 * present it as fact.
 */
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import type { RunwayAssignment } from "./assignRunway";

export type FieldRelation = "departing" | "arriving" | "unknown";

/** Vertical rate (ft/min) beyond which we treat the aircraft as climbing/descending. */
const CLIMB_FPM = 250;

/**
 * Is the aircraft leaving the field or coming to it? Uses the runway phase when we
 * have one, otherwise the vertical rate. "unknown" when level, on the ground, or the
 * rate is missing — i.e. when we shouldn't second-guess the route.
 */
export function fieldRelation(
  ac: Pick<Aircraft, "onGround" | "verticalRateFpm">,
  assignment: RunwayAssignment | null,
): FieldRelation {
  if (assignment?.phase === "approach") return "arriving";
  if (assignment?.phase === "departure") return "departing";
  if (ac.onGround) return "unknown";
  const vr = ac.verticalRateFpm;
  if (vr == null) return "unknown";
  if (vr >= CLIMB_FPM) return "departing";
  if (vr <= -CLIMB_FPM) return "arriving";
  return "unknown";
}

function isHome(
  a: { iata: string | null; icao: string | null } | null | undefined,
  iata: string,
  icao: string,
): boolean {
  if (!a) return false;
  const eq = (x: string | null, y: string) => x != null && x.toUpperCase() === y.toUpperCase();
  return eq(a.iata, iata) || eq(a.icao, icao);
}

export type RouteConflict = "departing-inbound-route" | "arriving-outbound-route" | null;

/**
 * Flag when the route contradicts the observed direction at the home field:
 *   departing-inbound-route — leaving our airport, but the route *ends* here (it's
 *     the inbound leg; the aircraft is really flying out);
 *   arriving-outbound-route — arriving at our airport, but the route *starts* here.
 * Returns null when the two agree, when our field isn't (uniquely) one endpoint, or
 * when the direction is undecidable.
 */
export function routeConflict(
  route: Pick<FlightRoute, "origin" | "destination"> | null | undefined,
  homeIata: string,
  homeIcao: string,
  relation: FieldRelation,
): RouteConflict {
  if (!route || relation === "unknown") return null;
  const homeIsDest = isHome(route.destination, homeIata, homeIcao);
  const homeIsOrig = isHome(route.origin, homeIata, homeIcao);
  if (homeIsDest === homeIsOrig) return null; // neither endpoint is home, or both are
  if (relation === "departing" && homeIsDest) return "departing-inbound-route";
  if (relation === "arriving" && homeIsOrig) return "arriving-outbound-route";
  return null;
}
