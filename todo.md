# TODO

## Architecture: canonical flight-state model (see ARCHITECTURE.md)
The `raw ADS-B → flight state` compute is centralized in `useLiveTraffic` + pure
`src/domain/*`, but there's **no canonical per-aircraft state** — the pipeline emits
parallel hex-keyed arrays and every consumer re-joins/re-derives them, so the same concept
(phase, AGL, counts, label) is computed several divergent ways. That's the regression
engine. Migrate to derive-once / select-many, in stages:

- [ ] **Stage 1 — canonical `FlightState`/`WorldState`.** Assemble one joined record per
      aircraft at the end of the pipeline (`{ ac, assignment, arrival?, departure?, phase,
      label, aglFt, heading, trail }`) plus a `byHex` index; migrate consumers to read it
      and delete the duplicated `flightStatusLabel`/`find`/`buildQueues`-input derivations.
- [ ] **Stage 2 — collapse duplicated primitives.** One `aglFt` fn (kill the 4 formulas),
      one phase definition feeding the label (kill the 5-way split), one shared reckoning
      clock/context replacing the four independent extrapolation clocks.
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
