import { createContext, useContext } from "react";
import type { Airport } from "../domain/airport";

/**
 * The active airport model, provided by `App`. Components read it with
 * `useAirport()` to project coordinates, list runways, etc. — none of them
 * reference a specific airport.
 */
export const AirportContext = createContext<Airport | null>(null);

export function useAirport(): Airport {
  const airport = useContext(AirportContext);
  if (!airport) {
    throw new Error("useAirport must be used within an AirportContext provider");
  }
  return airport;
}
