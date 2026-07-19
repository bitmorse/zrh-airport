import { useEffect, useRef, useState } from "react";

export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  ts: number;
}

/**
 * Continuously tracks the device location via `watchPosition` while `enabled`, so
 * measurements are tagged with the user's up-to-date position even as they move.
 * The latest fix is kept in a ref (read without re-render) and mirrored to state
 * for display. The watch is cleared when disabled or on unmount.
 */
export function useGeoWatch(enabled: boolean): {
  position: GeoFix | null;
  ref: React.MutableRefObject<GeoFix | null>;
} {
  const ref = useRef<GeoFix | null>(null);
  const [position, setPosition] = useState<GeoFix | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix: GeoFix = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          ts: p.timestamp,
        };
        ref.current = fix;
        setPosition(fix);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { position, ref };
}
