/**
 * Wind geometry for the optional map overlay: given how an aircraft is *travelling*
 * and where the wind is coming *from*, split the wind into the head/tail component
 * (along the track) and the crosswind component (across it), and work out which way
 * that crosswind physically pushes the aircraft. A planespotter can then see, before
 * the aircraft arrives, whether it's being shoved sideways (crabbing / one wing low)
 * or bounced by gusts.
 *
 * Meteorological convention: wind direction is the direction the wind blows *from*,
 * degrees true. All angles here are degrees true (0 = north, 90 = east).
 */

/** Normalise an angle difference into (-180, 180]. */
function wrap180(deg: number): number {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

/** Positive angle in [0, 360). */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface WindComponents {
  /** Along-track component, knots. Positive = headwind, negative = tailwind. */
  headKt: number;
  /** Across-track component, knots. Always ≥ 0 (magnitude of the sideways push). */
  crossKt: number;
  /**
   * True bearing the crosswind pushes the aircraft *toward* (perpendicular to
   * travel). Meaningless when `crossKt` is ~0 (pure head/tailwind).
   */
  pushDeg: number;
  /** Side the crosswind comes from, relative to the aircraft: "L", "R", or "" (none). */
  fromSide: "L" | "R" | "";
}

/**
 * Decompose `windKt` (blowing *from* `windFromDeg`) relative to an aircraft
 * travelling along `travelBearingDeg`.
 *
 * Wind from the aircraft's right pushes it to the left, and vice-versa. The push
 * bearing is therefore 90° off the travel bearing, on the downwind side.
 */
export function windComponents(
  travelBearingDeg: number,
  windFromDeg: number,
  windKt: number,
): WindComponents {
  const kt = Number.isFinite(windKt) ? Math.max(0, windKt) : 0;
  // Δ = where the wind comes from, relative to straight ahead. Δ>0 → from the right.
  const delta = wrap180(windFromDeg - travelBearingDeg);
  const rad = (delta * Math.PI) / 180;
  const headKt = kt * Math.cos(rad);
  const crossKt = kt * Math.abs(Math.sin(rad));
  const fromSide: "L" | "R" | "" = crossKt < 0.05 ? "" : delta > 0 ? "R" : "L";
  // Wind from the right (Δ>0) shoves the aircraft toward its left: bearing − 90.
  const pushDeg = norm360(travelBearingDeg + (delta > 0 ? -90 : 90));
  return { headKt, crossKt, pushDeg, fromSide };
}

/**
 * Gusty air is what makes an aircraft visibly bounce on short final. Treat the
 * spread between sustained wind and gust as the "bumpiness" signal.
 */
export function isGusty(windKt: number | null, gustKt: number | null): boolean {
  if (windKt == null || gustKt == null) return false;
  return gustKt - windKt >= 10;
}
