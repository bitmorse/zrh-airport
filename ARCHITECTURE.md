# Architecture — data flow & the flight-state model

This document describes how `raw ADS-B → flight state` flows through the app today, why
that shape has produced recurring regressions, and the target design we're migrating
toward (a single canonical per-aircraft state, derived once and selected many times).

## Today: the compute is centralized, the *state model* is not

**The estimation algorithms are centralized and mostly pure.** `src/hooks/useLiveTraffic.ts`
is a single choke point: one React-Query poll fetches ADS-B (`src/data/adsb.ts`,
failover across adsb.lol / adsb.fi / airplanes.live), then runs the whole pipeline —
`assignRunway` → `predictArrivals`/`trackApproachGates`/`trackLandings` →
`detectDepartures`/`trackDepartures`/`trackHolding` → `detectMovements` → trail/heading
build. The `src/domain/*` modules are ~15 mostly-pure functions; the only cross-poll
memory lives in `useRef` maps inside that one hook (`prevGs`, `holdingSince`, `depMemory`,
`gateCrossings`, `landingMemory`, `trails`, `headingMemory`, `countedMovements`).

**But there is no canonical per-aircraft "flight state" record.** `useLiveTraffic` emits
*parallel hex-keyed arrays* — `aircraft[]` (raw + assignment + heading), `arrivals[]`,
`departures[]`, `counts`, `trails` — and **every consumer re-joins them by hex and
re-derives the assembled truth itself.** The join is implicit and repeated at each call
site. That is the root cause of the regressions below, not "no central store" — the
*transport* is already central (React Query + one producer). What's missing is a single
*joined* state object and a "derive once, select many" discipline.

## Regression surface — the same concept computed multiple divergent ways

- **Phase / arriving-vs-departing is defined 5 ways**, each with different geometry and
  thresholds: `assignRunway` (`APPROACH_M=28000`), `detectDepartures`
  (`ON_RUNWAY_HALF_WIDTH_M=60`), `predictArrivals/isArriving`, `routeCheck.fieldRelation`
  (vertical-rate fallback), `flightStatusLabel` (own priority order).
- **Height-above-field (AGL) has 4 formulas**: `gpws.heightAglFt` (GNSS+geoid),
  `assignRunway.altAboveFieldFt` (baro-only, used by the geofence), inline in
  `attribution.ts`, and inline in `FlightDetails`. Geofence gate and GPWS callouts use
  different altitudes for the same plane.
- **Four independent between-poll extrapolation clocks** dead-reckon from the same raw
  fields: `PlaneLayer` and `TrailLayer` each run their own `useSmoothClock(120)`,
  `FlightDetails` a `useRafNow(100)`, `useGpws` a `setInterval(400)`. Glyph and its own
  trail's leading vertex can visibly disagree.
- **Heatmap counts vs the chart** use two different 4-way fallback chains (server
  `/recent` vs `/stats` vs device observations vs movement log) — they can disagree at
  the same instant (`App.tsx` heat/stat memos).
- **"Who's selected and what's their state" is resolved in ~7 places**;
  `flightStatusLabel` is called from both `App` and `TrafficBar` with different synthetic
  inputs; `buildQueues` runs inside `TrafficBar`, which is mounted twice.

Most regressions this project has hit fit the mold "two places computed the same thing and
one drifted" (the two label systems, `hasAudio`, Hz-vs-MHz, GPWS AudioContext contention).

## No raw-feed history (blocks the MCAP debug goal)

The raw provider JSON is discarded in `adsb.ts` (`normalise` drops `RawAircraft`), each
poll **overwrites** the last in the React-Query cache, and `buildNoiseMcap` only reads
persisted *noise events*. There is no rolling history of raw ADS-B, so "record raw +
processed state in one go" is currently impossible.

## Target: one canonical model, derived once

1. **`FlightState` — one record per aircraft**, assembled by a single derivation pass at
   the end of the pipeline, pre-joining everything a consumer needs:
   `{ ac (raw), assignment, arrival?, departure?, phase, label, aglFt, heading, trail }`.
2. **`WorldState = { flights: FlightState[], byHex: Map, arrivals, departures, counts, … }`**,
   read by components via **memoized selectors** (`buildQueues`, `onFrequencyCandidates`,
   `selectedStatus`, `depRow` become pure selectors over `WorldState`, not independent
   re-derivations).
3. **Collapse duplicated primitives**: one `aglFt`, one phase definition feeding the label,
   one shared reckoning clock (replace the four extrapolation clocks with a single
   `useReckonedWorld` context).
4. **Ring buffer of `{ rawSnapshot, worldState, t }`** per poll (a few minutes is tiny) →
   enables a "dump last N minutes to MCAP" (raw + processed) and a replay/diff harness for
   diagnosing where derived state diverges.

This is incremental *inside* the current architecture — React Query stays as transport;
`useLiveTraffic`'s output just becomes canonical. A thin context over `WorldState` can
later remove the prop-threading (App hands `traffic.*` to ~15 children individually), but
that's ergonomics; the correctness win is the canonical model.

## Migration stages (see todo.md)

1. Canonical `FlightState`/`WorldState` assembled once; migrate consumers to read it.
2. One AGL fn + one phase source + one shared reckoning clock.
3. Ring buffer of `{raw, world}` → MCAP session dump + replay harness.
