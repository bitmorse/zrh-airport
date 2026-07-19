/**
 * Flight route lookup via adsbdb.com — a free, no-key, CORS-enabled public API
 * that maps a callsign to its airline, IATA flight number and origin/destination
 * airports. Fully browser-side. Unknown callsigns (GA, private, unmapped) resolve
 * to null rather than throwing.
 */

export interface Airport {
  iata: string | null;
  icao: string | null;
  name: string | null;
  municipality: string | null;
  countryIso: string | null;
}

export interface FlightRoute {
  callsign: string;
  flightIata: string | null;
  airlineName: string | null;
  airlineIata: string | null;
  origin: Airport | null;
  destination: Airport | null;
}

interface RawAirport {
  iata_code?: string;
  icao_code?: string;
  name?: string;
  municipality?: string;
  country_iso_name?: string;
}

function mapAirport(a: RawAirport | undefined): Airport | null {
  if (!a) return null;
  return {
    iata: a.iata_code ?? null,
    icao: a.icao_code ?? null,
    name: a.name ?? null,
    municipality: a.municipality ?? null,
    countryIso: a.country_iso_name ?? null,
  };
}

export async function fetchFlightRoute(
  callsign: string,
  signal?: AbortSignal,
): Promise<FlightRoute | null> {
  const cs = callsign.trim().toUpperCase();
  if (!cs) return null;

  const res = await fetch(
    `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`,
    { signal, headers: { Accept: "application/json" } },
  );
  // adsbdb returns 404 with a string body for unknown callsigns.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`adsbdb HTTP ${res.status}`);

  const json = (await res.json()) as {
    response?:
      | string
      | {
          flightroute?: {
            callsign?: string;
            callsign_iata?: string;
            airline?: { name?: string; iata?: string };
            origin?: RawAirport;
            destination?: RawAirport;
          };
        };
  };

  if (!json.response || typeof json.response === "string") return null;
  const fr = json.response.flightroute;
  if (!fr) return null;

  return {
    callsign: fr.callsign ?? cs,
    flightIata: fr.callsign_iata ?? null,
    airlineName: fr.airline?.name ?? null,
    airlineIata: fr.airline?.iata ?? null,
    origin: mapAirport(fr.origin),
    destination: mapAirport(fr.destination),
  };
}
