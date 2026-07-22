# TODO

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
