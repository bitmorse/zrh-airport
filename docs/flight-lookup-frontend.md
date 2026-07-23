# Flight lookup API — frontend integration guide

On-request flight enrichment from FlightAware AeroAPI, proxied through **our**
backend so the API key never touches the browser. Use it to complement the live
ADS-B feed — most importantly, to find a flight the local radar can't see: one
**parked at the gate** that hasn't pushed back, or one just outside the query
radius. Full contract: `backend/api.md` (sections `GET /flight/{ident}` and
`GET /flight/{faFlightId}/position`).

> ⚠️ **This is a paid upstream, billed per call.** Only fetch on an **explicit user
> action** (a search submit, or a "get flight info" button) — never on hover,
> render, selection, or a poll. The backend caches and enforces a daily cap, but
> the frontend must not spam it.

## Base URL

Same origin as the stats API — reuse `STATS_BASE_URL` from `src/data/airportStats.ts`:

```
https://bitmorse.com/airports-api
```

## 1) Resolve a flight — `GET /flight/{ident}`

`{ident}` is a **designator**: an ICAO callsign or flight number, 2–12
alphanumerics, e.g. `SWR72` (the same string ADS-B broadcasts as `flight`). Trim
whitespace and uppercase it before sending.

```
GET /airports-api/flight/SWR72
```

Returns the leg most relevant to now (an in-progress leg wins, else the nearest
scheduled one). Shape (every field except the booleans may be `null`):

```ts
interface FlightLookup {
  faFlightId: string | null;   // pass to /position to pin it on the map
  ident: string | null; identIcao: string | null; identIata: string | null;
  registration: string | null; aircraftType: string | null;
  operator: string | null; operatorIcao: string | null; flightNumber: string | null;
  status: string | null;           // "Scheduled" | "Taxiing" | "En Route" | "Arrived" | ...
  progressPercent: number | null;  // 0–100
  cancelled: boolean; diverted: boolean; positionOnly: boolean;
  origin: Endpoint | null; destination: Endpoint | null;
  gateOrigin: string | null; gateDestination: string | null;
  terminalOrigin: string | null; terminalDestination: string | null; baggageClaim: string | null;
  // ISO8601 UTC strings. out/in = gate (pushback/arrival); off/on = wheels.
  scheduledOut, estimatedOut, actualOut: string | null;
  scheduledOff, estimatedOff, actualOff: string | null;
  scheduledOn,  estimatedOn,  actualOn:  string | null;
  scheduledIn,  estimatedIn,  actualIn:  string | null;
  departureDelay: number | null; arrivalDelay: number | null; // seconds
  route: string | null; routeDistance: number | null;
  filedAltitude: number | null; filedAirspeed: number | null;
  cached: boolean; generatedAt: number;   // stale?: true if served past TTL at the cap
}
interface Endpoint { icao: string | null; iata: string | null; name: string | null; city: string | null; }
```

Parse defensively (mirror `int()`/`num()` in `airportStats.ts`); any field can be `null`.

## 2) Pin it on the map (optional) — `GET /flight/{faFlightId}/position`

Only if you want to plot a searched flight that isn't in the live feed. Second call,
so gate it behind the same explicit action. `last_position` is often absent for a
truly parked jet → the position fields come back `null` but the call still `200`s
(show the info card without a map pin).

```
GET /airports-api/flight/SWR72-1721736000-airline-0123/position
```

```ts
interface FlightPosition {
  faFlightId: string | null; ident: string | null; aircraftType: string | null;
  origin: Endpoint | null; destination: Endpoint | null;
  lat: number | null; lon: number | null;   // WGS84 — feed straight into projectToSvg
  heading: number | null;                    // deg true
  altitude: number | null;                   // hundreds of ft / flight level (AeroAPI unit!)
  altitudeChange: string | null;             // "C" climb, "D" descend, "" level
  groundspeed: number | null;                // kt
  updateType: string | null;                 // A=ADS-B, X=surface, Z=radar, ...
  timestamp: string | null;                  // ISO8601 UTC of the fix
  cached: boolean; generatedAt: number;
}
```

Note the `altitude` unit differs from the ADS-B feed (hundreds of feet, not feet):
multiply by 100 before reusing altitude formatters.

## Status codes to handle

| Status | Meaning | UI |
|--------|---------|-----|
| `200` | Found | Render it. `cached`/`stale` are informational. |
| `404` `{"error":"flight not found"}` | No matching flight upstream | "No flight found for that number." |
| `400` `{"error":"invalid ident"}` | Ident failed validation | Validate input before sending (`/^[A-Za-z0-9]{2,12}$/`). |
| `429` `{"error":"daily flight-lookup limit reached"}` | Daily cap hit, nothing cached | "Flight lookup is at its daily limit — try later." |
| `501` `{"error":"flight lookup not configured"}` | No API key on the server | Hide the feature / show "unavailable". |
| `502` `{"error":"flight provider ..."}` | Upstream error | "Flight provider is unavailable right now." |

## Suggested wiring (react-query)

Keep the query **disabled** until the user acts — never auto-run:

```ts
// enabled:false; call refetch() (or set a submitted-ident state) on the search submit.
useQuery({
  queryKey: ["flightLookup", ident],
  queryFn: ({ signal }) => fetchFlightLookup(ident, signal),
  enabled: false,
  staleTime: 5 * 60_000,   // matches the server TTL; avoids duplicate billed calls
  gcTime: 30 * 60_000,
  retry: 0,                // don't retry a paid endpoint automatically
});
```

Don't put any API key in the frontend — the backend holds it. There's already a
free, automatic route lookup via adsbdb (`useFlightRoute`); this AeroAPI layer is
the richer, on-request complement (gate, terminal, delays, scheduled/actual times,
live status, and a position for off-radar flights).
