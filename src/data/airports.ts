import type { AirportConfig } from "../domain/airport";

/**
 * Supported airports. Threshold coordinates and elevations are from the
 * OurAirports dataset (WGS84). To add an airport, append a config here — nothing
 * else in the app hard-codes airport specifics.
 */

export const ZRH: AirportConfig = {
  icao: "LSZH",
  iata: "ZRH",
  name: "Zürich",
  arp: { lat: 47.4647, lon: 8.5492 },
  fieldElevationFt: 1416,
  runways: [
    {
      ends: [
        { id: "16", threshold: { lat: 47.475601, lon: 8.53595 } },
        { id: "34", threshold: { lat: 47.4454, lon: 8.55673 } },
      ],
    },
    {
      ends: [
        { id: "14", threshold: { lat: 47.483101, lon: 8.53473 } },
        { id: "32", threshold: { lat: 47.4613, lon: 8.56446 } },
      ],
    },
    {
      ends: [
        { id: "10", threshold: { lat: 47.4589, lon: 8.53747 } },
        { id: "28", threshold: { lat: 47.4566, lon: 8.57045 } },
      ],
    },
  ],
};

export const BKK: AirportConfig = {
  icao: "VTBS",
  iata: "BKK",
  name: "Bangkok Suvarnabhumi",
  arp: { lat: 13.6811, lon: 100.747 },
  fieldElevationFt: 5,
  runways: [
    {
      ends: [
        { id: "01", threshold: { lat: 13.656697, lon: 100.751831 } },
        { id: "19", threshold: { lat: 13.691714, lon: 100.761032 } },
      ],
    },
    {
      ends: [
        { id: "02R", threshold: { lat: 13.671278, lon: 100.734665 } },
        { id: "20L", threshold: { lat: 13.703669, lon: 100.743179 } },
      ],
    },
    {
      ends: [
        { id: "02L", threshold: { lat: 13.66517, lon: 100.72924 } },
        { id: "20R", threshold: { lat: 13.70016, lon: 100.73844 } },
      ],
    },
  ],
};

export const AIRPORTS: AirportConfig[] = [ZRH, BKK];

export const DEFAULT_AIRPORT_ICAO = ZRH.icao;

/** Look up a config by ICAO id, falling back to the default airport. */
export function airportConfigByIcao(icao: string): AirportConfig {
  return AIRPORTS.find((a) => a.icao === icao) ?? ZRH;
}
