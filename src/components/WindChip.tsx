import type { CurrentWind } from "../data/airportWeather";
import { isGusty } from "../lib/wind";

/** 16-point compass label for a from-direction in degrees true. */
const POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;
function compass(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Small corner readout of the current airport wind, part of the optional wind
 * overlay. The arrow points the way the wind is blowing (downwind) — the same way it
 * pushes the aircraft — while the label states the aviation "from" direction. Shows a
 * gust and, when winds aloft differ, a low-level shear hint. Wind is in knots (the
 * aviation convention, matching ATIS) regardless of the app's distance units.
 */
export function WindChip({ wind }: { wind: CurrentWind }) {
  const gusty = isGusty(wind.kt, wind.gustKt);
  // Downwind SVG rotation: true bearing (dir+180) maps to SVG angle (bearing − 90).
  const downwindSvgDeg = wind.dirDeg + 90;
  // Winds-aloft shear: flag when 80 m wind is notably stronger or veered from surface.
  const shear =
    wind.kt80 != null && wind.dir80 != null
      ? wind.kt80 - wind.kt >= 8 || angleGap(wind.dir80, wind.dirDeg) >= 30
      : false;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 border border-border bg-surface-container-lowest/90 px-2 py-1 text-on-surface backdrop-blur-sm">
      <svg viewBox="-12 -12 24 24" width={22} height={22} aria-hidden="true">
        <circle cx={0} cy={0} r={11} fill="none" stroke="var(--color-outline-variant)" strokeWidth={1} />
        <g transform={`rotate(${downwindSvgDeg.toFixed(0)})`} stroke="var(--color-on-surface-variant)" fill="var(--color-on-surface-variant)">
          {/* Shaft stops under the arrowhead base (x=2.5), not at the tip — a round cap
              at the tip would poke past the point. */}
          <line x1={-7} y1={0} x2={3.5} y2={0} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M7 0 L2.5 -3 L2.5 3 Z" />
        </g>
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] font-medium tabular-nums">
          {compass(wind.dirDeg)} {Math.round(wind.dirDeg).toString().padStart(3, "0")}° · {Math.round(wind.kt)} kt
          {wind.gustKt != null && wind.gustKt - wind.kt >= 1 && (
            <span className={gusty ? "text-status-alert" : "text-muted"}> G{Math.round(wind.gustKt)}</span>
          )}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-muted">
          wind{gusty ? " · gusty" : ""}{shear ? " · shear" : ""}
        </span>
      </div>
    </div>
  );
}

/** Smallest absolute angle between two bearings, degrees (0..180). */
function angleGap(a: number, b: number): number {
  const d = Math.abs(((a - b + 180) % 360) - 180);
  return d;
}
