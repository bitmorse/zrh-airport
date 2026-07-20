/**
 * Traffic heat scale — four discrete steps (no gradient, per DESIGN_1.md):
 * quiet grey → amber → orange → busy red. The actual colours live as design tokens
 * (`--color-heat-0..3`); this module only maps a count to the right step. Used both
 * for filling runway ends and for the legend's stepped swatches.
 */

/** The four scale steps, coldest → hottest, as token references. */
export const HEAT_STEPS = [
  "var(--color-heat-0)", // no / low traffic
  "var(--color-heat-1)", // some
  "var(--color-heat-2)", // busy
  "var(--color-heat-3)", // very busy
] as const;

/** Count at which the scale saturates to the hottest step. */
export const HEAT_MAX = 8;

/** Pick the discrete heat step for a distinct-aircraft count. */
export function heatColor(count: number, max = HEAT_MAX): string {
  const f = Math.max(0, Math.min(1, count / max));
  const idx = Math.min(HEAT_STEPS.length - 1, Math.floor(f * HEAT_STEPS.length));
  return HEAT_STEPS[idx];
}
