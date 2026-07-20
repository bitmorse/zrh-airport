import { useEffect, useRef, useState } from "react";

/** Smallest absolute difference between two bearings, in [0, 180]. */
function bearingDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** iOS exposes an absolute compass heading; add it to the standard event type. */
interface CompassEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/** iOS 13+ gates orientation behind a permission prompt (must be a user gesture). */
type PermissionCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * Ask for device-orientation permission where required (iOS). Call from a user
 * gesture (e.g. the locate button). A no-op elsewhere; resolves true when usable.
 */
export async function requestHeadingPermission(): Promise<boolean> {
  const Ctor = (typeof DeviceOrientationEvent !== "undefined"
    ? DeviceOrientationEvent
    : undefined) as PermissionCtor | undefined;
  if (Ctor?.requestPermission) {
    try {
      return (await Ctor.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * The device's compass heading in degrees (0 = north, clockwise), or null until a
 * reading arrives / when unsupported. Prefers iOS `webkitCompassHeading` (already
 * true-north, clockwise); otherwise derives it from the absolute `alpha`, corrected
 * for the current screen rotation. Best-effort — hardware and permissions vary.
 */
export function useDeviceHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onOrient = (e: DeviceOrientationEvent) => {
      const compass = (e as CompassEvent).webkitCompassHeading;
      let deg: number | null = null;
      if (typeof compass === "number" && Number.isFinite(compass)) {
        deg = compass; // iOS: clockwise from true north
      } else if (e.absolute && typeof e.alpha === "number") {
        const screen = window.screen?.orientation?.angle ?? 0;
        deg = (360 - e.alpha + screen) % 360; // alpha is counter-clockwise from north
      }
      if (deg == null || !Number.isFinite(deg)) return;
      const norm = ((deg % 360) + 360) % 360;
      // Throttle: the sensor fires ~60 Hz; only re-render on a meaningful change so
      // the memoised map isn't churned.
      if (last.current == null || bearingDelta(last.current, norm) >= 2) {
        last.current = norm;
        setHeading(norm);
      }
    };

    // `deviceorientationabsolute` is the reliable true-north source where available.
    window.addEventListener("deviceorientationabsolute", onOrient as EventListener);
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrient as EventListener);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, [enabled]);

  return enabled ? heading : null;
}
