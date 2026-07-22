import type { Aircraft } from "../data/adsb";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import type { RunwayAssignment } from "./assignRunway";
import type { DepartureEvent } from "./departures";
import { flightStatusLabel, type FlightStatus } from "./flightStatus";
import { heightAglFt } from "./gpws";
import type { Arrival } from "./predictions";

/**
 * The canonical per-aircraft state — one record that pre-joins everything the pipeline
 * knows about a plane, so consumers read a finished value instead of re-joining the
 * parallel `aircraft` / `arrivals` / `departures` arrays by hex and re-deriving the same
 * truth five different ways (the historical source of "two places computed it, one
 * drifted" regressions). Assembled once, at the end of the poll, by `buildFlightStates`.
 * The position trail is intentionally left out — it's large and lives behind
 * `trailFor(hex)` — so a FlightState stays a cheap, joined snapshot.
 */
export interface FlightState {
  hex: string;
  /** Raw normalized ADS-B record, retained verbatim. */
  ac: Aircraft;
  assignment: RunwayAssignment | null;
  /** Live arrival prediction for this hex, if any. */
  arrival: Arrival | null;
  /** Live departure event for this hex, if any. */
  departure: DepartureEvent | null;
  /** Glyph heading (trail-derived on the ground); null when unknown. */
  heading: number | null;
  /** Meaningful phase phrase — the single `flightStatusLabel` result for this plane. */
  status: FlightStatus;
  /** Height above field, feet — the single AGL definition (`heightAglFt`). */
  aglFt: number;
  /** Using a runway (approach/runway/departure corridor) right now. */
  active: boolean;
}

/**
 * Join the poll's parallel arrays into one `FlightState` per aircraft, plus a `byHex`
 * index. Pure: reuses `flightStatusLabel` and `heightAglFt` so the phase word and the
 * height are each computed exactly once here rather than re-derived at every consumer.
 */
export function buildFlightStates(
  withAssignment: AircraftWithAssignment[],
  arrivals: Arrival[],
  departures: DepartureEvent[],
  fieldElevationFt: number,
  geoidFt: number,
): { flights: FlightState[]; byHex: Map<string, FlightState> } {
  const arrivalByHex = new Map(arrivals.map((a) => [a.hex, a]));
  const departureByHex = new Map(departures.map((d) => [d.hex, d]));
  const flights: FlightState[] = [];
  const byHex = new Map<string, FlightState>();

  for (const w of withAssignment) {
    const { ac, assignment } = w;
    const arrival = arrivalByHex.get(ac.hex) ?? null;
    const departure = departureByHex.get(ac.hex) ?? null;
    const flight: FlightState = {
      hex: ac.hex,
      ac,
      assignment,
      arrival,
      departure,
      heading: w.heading ?? null,
      status: flightStatusLabel({ ac, assignment, arrival, departure }),
      aglFt: heightAglFt(ac, fieldElevationFt, geoidFt),
      active: assignment != null,
    };
    flights.push(flight);
    byHex.set(ac.hex, flight);
  }

  return { flights, byHex };
}
