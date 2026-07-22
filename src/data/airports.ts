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
  timeZone: "Europe/Zurich",
  arp: { lat: 47.4647, lon: 8.5492 },
  fieldElevationFt: 1416,
  geoidFt: 157, // EGM96 undulation ≈ +48 m

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

  frequencies: [
    { label: "Tower", mhz: "118.100" },
    { label: "Ground", mhz: "121.902" },
    { label: "Apron N", mhz: "121.855" },
    { label: "Apron S", mhz: "121.755" },
    { label: "Delivery", mhz: "121.925" },
    { label: "ATIS", mhz: "125.725" },
    { label: "Approach", mhz: "125.325" },
    { label: "Departure", mhz: "125.950" },
  ],
};

export const BKK: AirportConfig = {
  icao: "VTBS",
  iata: "BKK",
  name: "Bangkok Suvarnabhumi",
  timeZone: "Asia/Bangkok",
  arp: { lat: 13.6811, lon: 100.747 },
  fieldElevationFt: 5,
  geoidFt: -98, // EGM96 undulation ≈ −30 m

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

  frequencies: [
    { label: "Tower 01L/19R", mhz: "119.000" },
    { label: "Tower 01R/19L", mhz: "118.200" },
    { label: "Ground (Main)", mhz: "121.750" },
    { label: "Ground (East)", mhz: "121.650" },
    { label: "Ground (West)", mhz: "121.950" },
    { label: "ATIS", mhz: "127.800" },
  ],
};

export const BSL: AirportConfig = {
  icao: "LFSB",
  iata: "BSL",
  name: "Basel EuroAirport",
  timeZone: "Europe/Paris",
  arp: { lat: 47.60068, lon: 7.521117 },
  fieldElevationFt: 885,
  geoidFt: 157, // EGM96 undulation ≈ +48 m

  runways: [
    {
      ends: [
        { id: "15", threshold: { lat: 47.617699, lon: 7.509862 } },
        { id: "33", threshold: { lat: 47.585933, lon: 7.531962 } },
      ],
    },
    {
      ends: [
        { id: "07", threshold: { lat: 47.587943, lon: 7.516868 } },
        { id: "25", threshold: { lat: 47.591429, lon: 7.539109 } },
      ],
    },
  ],

  frequencies: [
    { label: "Tower", mhz: "118.300" },
    { label: "Ground", mhz: "121.600" },
    { label: "Approach", mhz: "118.575" },
    { label: "Info", mhz: "121.250" },
    { label: "ATIS", mhz: "127.875" },
  ],
};

export const GVA: AirportConfig = {
  icao: "LSGG",
  iata: "GVA",
  name: "Geneva",
  timeZone: "Europe/Zurich",
  arp: { lat: 46.238098, lon: 6.10895 },
  fieldElevationFt: 1411,
  geoidFt: 160, // EGM96 undulation ≈ +49 m

  runways: [
    {
      ends: [
        { id: "04", threshold: { lat: 46.2258, lon: 6.09092 } },
        { id: "22", threshold: { lat: 46.250401, lon: 6.12699 } },
      ],
    },
  ],

  frequencies: [
    { label: "Tower", mhz: "118.700" },
    { label: "Ground", mhz: "121.675" },
    { label: "Apron", mhz: "121.750" },
    { label: "Approach", mhz: "120.300" },
    { label: "Departure", mhz: "119.525" },
    { label: "ATIS", mhz: "135.575" },
  ],
};

export const MXP: AirportConfig = {
  icao: "LIMC",
  iata: "MXP",
  name: "Milan Malpensa",
  timeZone: "Europe/Rome",
  arp: { lat: 45.6306, lon: 8.72811 },
  fieldElevationFt: 768,
  geoidFt: 156, // EGM96 undulation ≈ +48 m

  runways: [
    {
      ends: [
        { id: "17L", threshold: { lat: 45.650385, lon: 8.727939 } },
        { id: "35R", threshold: { lat: 45.615741, lon: 8.737507 } },
      ],
    },
    {
      ends: [
        { id: "17R", threshold: { lat: 45.645449, lon: 8.718736 } },
        { id: "35L", threshold: { lat: 45.610824, lon: 8.728302 } },
      ],
    },
  ],

  frequencies: [
    { label: "Tower", mhz: "119.000" },
    { label: "Ground", mhz: "121.900" },
    { label: "Delivery", mhz: "120.900" },
    { label: "Approach", mhz: "132.700" },
    { label: "Departure", mhz: "126.750" },
    { label: "ATIS", mhz: "120.025" },
  ],
};

export const FRA: AirportConfig = {
  icao: "EDDF",
  iata: "FRA",
  name: "Frankfurt",
  timeZone: "Europe/Berlin",
  arp: { lat: 50.026706, lon: 8.55835 },
  fieldElevationFt: 364,
  geoidFt: 154, // EGM96 undulation ≈ +47 m

  runways: [
    {
      ends: [
        { id: "07C", threshold: { lat: 50.0326004, lon: 8.53462982 } },
        { id: "25C", threshold: { lat: 50.04510117, lon: 8.58697987 } },
      ],
    },
    {
      ends: [
        { id: "07R", threshold: { lat: 50.02750015, lon: 8.53417015 } },
        { id: "25L", threshold: { lat: 50.0401001, lon: 8.58652973 } },
      ],
    },
    {
      ends: [
        { id: "07L", threshold: { lat: 50.03710175, lon: 8.49707985 } },
        { id: "25R", threshold: { lat: 50.04579926, lon: 8.53372002 } },
      ],
    },
    {
      // Startbahn West — used for southbound departures ("18") only.
      ends: [
        { id: "18", threshold: { lat: 50.034154, lon: 8.525944 } },
        { id: "36", threshold: { lat: 49.998493, lon: 8.526297 } },
      ],
    },
  ],

  frequencies: [
    { label: "Tower S", mhz: "119.905" },
    { label: "Tower N", mhz: "136.500" },
    { label: "Tower RWY18", mhz: "124.855" },
    { label: "Ground", mhz: "121.805" },
    { label: "Apron", mhz: "121.655" },
    { label: "Delivery", mhz: "122.035" },
    { label: "Approach", mhz: "118.450" },
    { label: "ATIS Arr", mhz: "118.030" },
    { label: "ATIS Dep", mhz: "118.730" },
  ],
};

export const HKG: AirportConfig = {
  icao: "VHHH",
  iata: "HKG",
  name: "Hong Kong",
  timeZone: "Asia/Hong_Kong",
  arp: { lat: 22.31184, lon: 113.914862 },
  fieldElevationFt: 28,
  geoidFt: 8, // EGM96 undulation ≈ +2 m

  runways: [
    {
      ends: [
        { id: "07L", threshold: { lat: 22.321074, lon: 113.880692 } },
        { id: "25R", threshold: { lat: 22.332306, lon: 113.915558 } },
      ],
    },
    {
      ends: [
        { id: "07C", threshold: { lat: 22.31040001, lon: 113.89600372 } },
        { id: "25C", threshold: { lat: 22.32159996, lon: 113.93099976 } },
      ],
    },
    {
      ends: [
        { id: "07R", threshold: { lat: 22.2962, lon: 113.898003 } },
        { id: "25L", threshold: { lat: 22.307431, lon: 113.932819 } },
      ],
    },
  ],

  frequencies: [
    { label: "Tower N", mhz: "118.200" },
    { label: "Tower S", mhz: "118.400" },
    { label: "Ground N", mhz: "121.600" },
    { label: "Ground S", mhz: "122.550" },
    { label: "Delivery", mhz: "129.900" },
    { label: "Approach", mhz: "119.100" },
    { label: "Departure", mhz: "123.800" },
    { label: "ATIS Arr", mhz: "128.200" },
    { label: "ATIS Dep", mhz: "127.050" },
  ],
};

export const AIRPORTS: AirportConfig[] = [ZRH, GVA, BSL, MXP, FRA, HKG, BKK];

export const DEFAULT_AIRPORT_ICAO = ZRH.icao;

/** Look up a config by ICAO id, falling back to the default airport. */
export function airportConfigByIcao(icao: string): AirportConfig {
  return AIRPORTS.find((a) => a.icao === icao) ?? ZRH;
}
