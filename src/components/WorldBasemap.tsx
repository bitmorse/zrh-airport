import { memo, useEffect, useMemo, useState } from "react";
import type { LatLon } from "../lib/geo";
import { projectToSvg, SVG_W } from "../lib/projection";

/**
 * Faint country outlines under the runways, projected through the *same* airport
 * projection as everything else (tangent-plane around the field). Invisible at the
 * default zoom — the field world is a speck on this scale — but when the map zooms out
 * to frame a searched flight a few hundred km away, the coastlines give it context.
 *
 * The GeoJSON (~150 KB) is dynamically imported so it stays out of the main bundle and
 * only loads once, lazily. Rings that fall entirely outside the regional range are
 * dropped so the projected path stays small (and free of absurd far-side coordinates,
 * where the tangent projection is meaningless anyway).
 */

type Ring = [number, number][];

// Keep only geometry within ~this many SVG units of the field — a bit past the regional
// pan range (see lib/viewport REGIONAL_PAN). Everything else is off any usable view.
const CULL_PX = 120_000;

function basemapPath(rings: Ring[], arp: LatLon): string {
  const loX = -CULL_PX;
  const hiX = SVG_W + CULL_PX;
  let d = "";
  for (const ring of rings) {
    const pts = ring.map(([lon, lat]) => projectToSvg(arp, { lat, lon }));
    // Drop rings with no vertex anywhere near the field — nothing to draw on any view.
    if (!pts.some((p) => p.x > loX && p.x < hiX && p.y > loX && p.y < hiX)) continue;
    for (let i = 0; i < pts.length; i++) {
      d += (i === 0 ? "M" : "L") + pts[i].x.toFixed(0) + " " + pts[i].y.toFixed(0);
    }
    d += "Z";
  }
  return d;
}

function WorldBasemapImpl({ arp }: { arp: LatLon }) {
  const [rings, setRings] = useState<Ring[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import("../data/world-110m.geo.json").then((m) => {
      if (alive) setRings((m.default as { rings: Ring[] }).rings);
    });
    return () => {
      alive = false;
    };
  }, []);

  const d = useMemo(() => (rings ? basemapPath(rings, arp) : ""), [rings, arp]);
  if (!d) return null;

  return (
    <path
      d={d}
      fill="none"
      stroke="var(--color-outline-variant)"
      strokeWidth={1}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      opacity={0.7}
      aria-hidden="true"
    />
  );
}

// Memoised: the basemap only depends on the airport, so it never rebuilds on a poll.
export const WorldBasemap = memo(WorldBasemapImpl);
