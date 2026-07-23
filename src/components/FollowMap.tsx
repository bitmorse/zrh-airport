import { useEffect, useMemo, useRef, useState } from "react";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import { useSmoothClock } from "../hooks/useSmoothClock";
import type { LatLon } from "../lib/geo";
import { reckonPosition } from "../lib/reckon";
import {
  countryPath,
  followViewBox,
  graticulePath,
  greatCircleSegments,
  project,
  type Ring,
} from "../lib/worldMap";
import { AIRPLANE_PATH } from "./icons";

/** Vertical span (degrees) shown around the aircraft — the follow "zoom". */
const SPAN_DEG = 44;
const ASPECT = 3 / 2; // viewBox width:height; the SVG slices to fill its box

interface WorldData {
  rings: Ring[];
}

/**
 * The follow-a-flight world map: a self-contained vector basemap (bundled country
 * outlines, dynamically imported) centred on the tracked aircraft, with its trail and
 * origin→dest great-circle. The world is projected once (equirectangular); following is
 * just a viewBox centred on the plane's dead-reckoned position, animated by the shared
 * smooth clock so it glides between polls.
 */
export function FollowMap({
  aircraft,
  route,
  lastUpdated,
}: {
  aircraft: Aircraft | null;
  route: FlightRoute | null;
  lastUpdated: number | null;
}) {
  const now = useSmoothClock();
  const [rings, setRings] = useState<Ring[] | null>(null);

  useEffect(() => {
    let ok = true;
    void import("../data/world-110m.geo.json").then((m) => {
      if (ok) setRings((m.default as WorldData).rings);
    });
    return () => {
      ok = false;
    };
  }, []);

  const worldD = useMemo(() => (rings ? countryPath(rings) : ""), [rings]);
  const gratD = useMemo(() => graticulePath(30), []);

  // Accumulate a trail from the polled positions; reset when the tracked airframe changes.
  const trail = useRef<LatLon[]>([]);
  useEffect(() => {
    trail.current = [];
  }, [aircraft?.hex]);
  useEffect(() => {
    if (!aircraft) return;
    const t = trail.current;
    const last = t[t.length - 1];
    if (!last || last.lat !== aircraft.lat || last.lon !== aircraft.lon) {
      t.push({ lat: aircraft.lat, lon: aircraft.lon });
      if (t.length > 300) t.shift();
    }
  }, [aircraft]);

  const pos = aircraft ? reckonPosition(aircraft, lastUpdated, now) : null;
  const origin = route?.origin?.lat != null && route.origin.lon != null ? route.origin : null;
  const dest = route?.destination?.lat != null && route.destination.lon != null ? route.destination : null;

  // Centre on the plane; before it's found, frame the route (origin) or the world.
  const center: LatLon =
    pos ??
    (origin ? { lat: origin.lat!, lon: origin.lon! } : { lat: 25, lon: 0 });
  const vb = followViewBox(center.lon, center.lat, pos ? SPAN_DEG : 120, ASPECT);
  const glyph = (pos ? SPAN_DEG : 120) * 0.03; // world-unit size that reads ~constant

  const routeSegs =
    origin && dest
      ? greatCircleSegments(
          { lat: origin.lat!, lon: origin.lon! },
          { lat: dest.lat!, lon: dest.lon! },
        )
      : [];
  const trailD = trail.current
    .map((p, i) => {
      const q = project(p.lon, p.lat);
      return `${i === 0 ? "M" : "L"}${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
    })
    .join("");

  const heading = aircraft?.track ?? 0;
  const planePt = pos ? project(pos.lon, pos.lat) : null;
  const endpoint = (a: NonNullable<typeof origin>) => project(a.lon!, a.lat!);

  return (
    <svg
      viewBox={vb}
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full select-none"
      role="img"
      aria-label="World map following the tracked flight"
    >
      {/* All line strokes are non-scaling (constant screen px) regardless of the zoom. */}
      <rect x={0} y={0} width={360} height={180} fill="var(--color-surface-container-lowest)" />
      <path
        d={gratD}
        fill="none"
        stroke="var(--color-outline-variant)"
        strokeWidth={0.5}
        strokeOpacity={0.4}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={worldD}
        fill="none"
        stroke="var(--color-on-surface-variant)"
        strokeWidth={0.8}
        strokeOpacity={0.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Origin → destination great-circle. */}
      {routeSegs.map((seg, i) => (
        <polyline
          key={i}
          points={seg.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
          fill="none"
          stroke="var(--color-status-arrival)"
          strokeWidth={1.4}
          strokeOpacity={0.6}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {origin && (
        <EndpointDot pt={endpoint(origin)} label={origin.iata ?? origin.icao ?? ""} size={glyph} />
      )}
      {dest && <EndpointDot pt={endpoint(dest)} label={dest.iata ?? dest.icao ?? ""} size={glyph} />}

      {/* Flown trail. */}
      {trail.current.length > 1 && (
        <path
          d={trailD}
          fill="none"
          stroke="var(--color-status-arrival)"
          strokeWidth={2}
          strokeOpacity={0.55}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* The aircraft, glyph sized in world units and pointed along its track. */}
      {planePt && (
        <g transform={`translate(${planePt.x.toFixed(2)} ${planePt.y.toFixed(2)})`}>
          <g transform={`rotate(${(heading - 90).toFixed(0)}) scale(${(glyph / 24).toFixed(4)}) translate(-12 -12)`}>
            <path
              d={AIRPLANE_PATH}
              fill="var(--color-status-arrival)"
              stroke="var(--color-surface-container-lowest)"
              strokeWidth={2}
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </g>
        </g>
      )}
    </svg>
  );
}

function EndpointDot({ pt, label, size }: { pt: { x: number; y: number }; label: string; size: number }) {
  return (
    <g transform={`translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`}>
      <circle r={size * 0.35} fill="var(--color-status-arrival)" />
      <text
        x={size * 0.6}
        y={size * 0.2}
        fontSize={size * 0.9}
        fill="var(--color-on-surface-variant)"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </text>
    </g>
  );
}
