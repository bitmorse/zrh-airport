/**
 * Traffic heat scale: grey (no traffic) → amber → orange → red (busy). Used both
 * for filling runway ends and for drawing the legend gradient.
 */

type RGB = [number, number, number];

const STOPS: { t: number; c: RGB }[] = [
  { t: 0.0, c: [71, 85, 105] }, // slate grey — no traffic
  { t: 0.33, c: [234, 179, 8] }, // amber
  { t: 0.66, c: [249, 115, 22] }, // orange
  { t: 1.0, c: [220, 38, 38] }, // red — busy
];

/** Count at which the scale saturates to full red. */
export const HEAT_MAX = 8;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colorAt(fraction: number): RGB {
  const f = Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < STOPS.length; i++) {
    const prev = STOPS[i - 1];
    const next = STOPS[i];
    if (f <= next.t) {
      const local = (f - prev.t) / (next.t - prev.t || 1);
      return [
        Math.round(lerp(prev.c[0], next.c[0], local)),
        Math.round(lerp(prev.c[1], next.c[1], local)),
        Math.round(lerp(prev.c[2], next.c[2], local)),
      ];
    }
  }
  return STOPS[STOPS.length - 1].c;
}

export function heatColor(count: number, max = HEAT_MAX): string {
  const [r, g, b] = colorAt(count / max);
  return `rgb(${r} ${g} ${b})`;
}

/** CSS gradient stops for the legend bar. */
export function heatGradientCss(steps = 12): string {
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const [r, g, b] = colorAt(f);
    parts.push(`rgb(${r} ${g} ${b}) ${Math.round(f * 100)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
