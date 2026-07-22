# TODO

## Architecture: canonical flight-state model (see ARCHITECTURE.md)
The `raw ADS-B → flight state` compute is centralized in `useLiveTraffic` + pure
`src/domain/*`, but there's **no canonical per-aircraft state** — the pipeline emits
parallel hex-keyed arrays and every consumer re-joins/re-derives them, so the same concept
(phase, AGL, counts, label) is computed several divergent ways. That's the regression
engine. Migrate to derive-once / select-many, in stages:

- [x] **Stage 1 — canonical `FlightState`/`WorldState`.** `src/domain/flightState.ts` +
      `byHex` index; consumers (App, TrafficBar, AirportSvg) read the joined record. Killed
      the duplicated `flightStatusLabel` (App + TrafficBar) and the scattered selection
      lookups. `FlightState.status` is now the single consumed phase label.
- [x] **Stage 2 — collapse duplicated primitives.**
      - [x] One shared reckoning clock: `useSmoothClock` is now a single rAF singleton;
            PlaneLayer + TrailLayer + FlightDetails read the same tick (glyph, trail and
            readout in lock-step). Removed `useRafNow`. `useGpws` keeps its own 400 ms engine
            cadence (state machine, not rendering) — intentionally separate.
      - [x] One "height above field": `heightAglFt` (geoid-optional) is the single fn;
            geofence now uses it and `assignRunway.altAboveFieldFt` is deleted.
      - Note (not a bug): the other apparent "AGL"/"phase" duplicates are distinct-purpose,
        not redundancies — `attribution` computes *slant range per trail sample*,
        `FlightDetails` shows *both* GNSS + baro reckoned (a deliberate dual readout), and the
        5 "phase" detectors are a pipeline feeding the one `flightStatusLabel`. Not merged.
- [ ] **Stage 3 — raw+processed recording.** Bounded ring buffer of `{ rawSnapshot,
      worldState, t }` per poll → "dump last N minutes to MCAP" (raw ADS-B + derived state)
      and a replay/diff harness to pinpoint where derived state diverges.

## Auto-zoom / map reveal fixes
The reveal (auto-zoom on selection / auto-select) has several issues — see
`src/hooks/useViewport.ts`, `src/lib/viewport.ts`, and the reveal effect in
`src/components/AirportSvg.tsx`.

- [ ] **Don't persist automatic reveals.** `animateTo` writes through `applyDom` →
      `schedulePersist` every frame, so an auto-select camera move saves its zoom/centre to
      settings and a reload restores a view the user never chose. Persist only user gestures.
- [ ] **Skip the reveal when the target is already comfortably visible** (first-selection
      currently always re-frames, overriding a deliberate zoom).
- [ ] **On drift, pan without re-fitting zoom.** Drift re-reveal recomputes `fitPoints`, so
      the zoom lurches stepwise while tracking a moving plane. Recenter only; keep zoom stable.
- [ ] **Cap how far out a reveal zooms.** `focusOn` always includes `fieldCenter`, so a distant
      approach frames the whole field and the aircraft becomes a tiny dot. Give the target a
      minimum on-screen size, or drop the field context past some distance.
- [ ] **Respect `prefers-reduced-motion`** — `animateTo` always tweens; jump instead when the
      user asks for reduced motion.
- [ ] **Reveal to the drawn (dead-reckoned) glyph position, not the raw poll lat/lon** — on the
      15 s poll a fast jet is drawn well away from `sel.ac.lat/lon`, so the reveal centres off
      the visible aircraft.
