import { describe, expect, it } from "vitest";
import { currentWind, type AirportWeather, type WeatherHour } from "./airportWeather";

const HOUR = 3600_000;

function hour(over: Partial<WeatherHour> & { tsUtc: number }): WeatherHour {
  return {
    windDir: 250,
    windKt: 12,
    gustKt: 18,
    windKt80m: null,
    windDir80m: null,
    tempC: null,
    ...over,
  };
}

function weather(hours: WeatherHour[]): AirportWeather {
  return { hours, generatedAt: 0 };
}

describe("currentWind", () => {
  it("picks the most recent hour at or before now", () => {
    const w = weather([
      hour({ tsUtc: 0, windDir: 100, windKt: 5 }),
      hour({ tsUtc: HOUR, windDir: 200, windKt: 10 }),
      hour({ tsUtc: 2 * HOUR, windDir: 300, windKt: 15 }), // future
    ]);
    const cur = currentWind(w, HOUR + 30 * 60_000); // 1.5 h in
    expect(cur?.dirDeg).toBe(200);
    expect(cur?.kt).toBe(10);
  });

  it("falls back to the earliest hour when all are in the future", () => {
    const w = weather([
      hour({ tsUtc: 5 * HOUR, windDir: 100, windKt: 5 }),
      hour({ tsUtc: 6 * HOUR, windDir: 200, windKt: 10 }),
    ]);
    expect(currentWind(w, 0)?.dirDeg).toBe(100);
  });

  it("returns null when the chosen hour lacks wind direction or speed", () => {
    const w = weather([hour({ tsUtc: 0, windDir: null, windKt: 12 })]);
    expect(currentWind(w, HOUR)).toBeNull();
  });

  it("returns null for empty or missing weather", () => {
    expect(currentWind(weather([]), 0)).toBeNull();
    expect(currentWind(undefined, 0)).toBeNull();
  });

  it("carries gust and winds-aloft through", () => {
    const w = weather([
      hour({ tsUtc: 0, windDir: 240, windKt: 14, gustKt: 26, windDir80m: 250, windKt80m: 22 }),
    ]);
    const cur = currentWind(w, HOUR);
    expect(cur).toEqual({ dirDeg: 240, kt: 14, gustKt: 26, dir80: 250, kt80: 22 });
  });
});
