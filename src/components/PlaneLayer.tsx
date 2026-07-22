import { memo } from "react";
import type { CurrentWind } from "../data/airportWeather";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useSmoothClock } from "../hooks/useSmoothClock";
import { reckonPosition } from "../lib/reckon";
import { Plane } from "./Plane";

/**
 * Renders aircraft with dead reckoning: between polls each airborne aircraft is
 * advanced along its track at its groundspeed so the icons glide smoothly instead
 * of jumping. Positions snap back to truth on the next poll.
 */
function PlaneLayerImpl({
  aircraft,
  lastUpdated,
  selectedHex,
  onSelect,
  wind,
}: {
  aircraft: AircraftWithAssignment[];
  lastUpdated: number | null;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
  /** Current airport wind for the optional crosswind arrows; null/undefined = off. */
  wind?: CurrentWind | null;
}) {
  const now = useSmoothClock();
  return (
    <g>
      {aircraft.map((item) => (
        <Plane
          key={item.ac.hex}
          item={item}
          pos={reckonPosition(item.ac, lastUpdated, now)}
          selected={item.ac.hex === selectedHex}
          onSelect={onSelect}
          wind={wind}
        />
      ))}
    </g>
  );
}

// Memoised so unrelated map re-renders (GPS/heading/selection/locate) don't rebuild
// every plane; the shared smooth-clock drives the dead-reckoning animation.
export const PlaneLayer = memo(PlaneLayerImpl);
