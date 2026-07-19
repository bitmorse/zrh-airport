import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { useSmoothClock } from "../hooks/useSmoothClock";
import { destinationPoint } from "../lib/geo";
import { Plane } from "./Plane";

const KT_TO_MS = 0.514444;
const MAX_EXTRAPOLATE_S = 60; // stop dead-reckoning if the feed stalls

/**
 * Renders aircraft with dead reckoning: between polls each airborne aircraft is
 * advanced along its track at its groundspeed so the icons glide smoothly instead
 * of jumping. Positions snap back to truth on the next poll.
 */
export function PlaneLayer({
  aircraft,
  lastUpdated,
  selectedHex,
  onSelect,
}: {
  aircraft: AircraftWithAssignment[];
  lastUpdated: number | null;
  selectedHex?: string | null;
  onSelect?: (hex: string) => void;
}) {
  const now = useSmoothClock(120);
  return (
    <g>
      {aircraft.map((item) => {
        const { ac } = item;
        let pos = { lat: ac.lat, lon: ac.lon };
        if (
          !ac.onGround &&
          ac.gs != null &&
          ac.gs > 0 &&
          ac.track != null &&
          lastUpdated != null
        ) {
          const ageSec = Math.min(
            MAX_EXTRAPOLATE_S,
            (now - lastUpdated) / 1000 + (ac.seenPos ?? 0),
          );
          if (ageSec > 0) {
            pos = destinationPoint(pos, ac.track, ac.gs * KT_TO_MS * ageSec);
          }
        }
        return (
          <Plane
            key={ac.hex}
            item={item}
            pos={pos}
            selected={ac.hex === selectedHex}
            onSelect={onSelect}
          />
        );
      })}
    </g>
  );
}
