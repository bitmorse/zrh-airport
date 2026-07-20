import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "./useAirport";
import type { AircraftWithAssignment } from "./useLiveTraffic";
import { useGpws } from "./useGpws";

const AP = buildAirport(ZRH);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AirportContext.Provider value={AP}>{children}</AirportContext.Provider>
);

/** An aircraft `aglFt` above the field, descending at `vr` fpm. */
function item(aglFt: number, vr: number): AircraftWithAssignment {
  const geoid = AP.config.geoidFt ?? 0;
  const ac: Aircraft = {
    hex: "a1",
    flight: "SWR1",
    lat: 47.45,
    lon: 8.55,
    altFt: AP.config.fieldElevationFt + aglFt,
    altGeomFt: AP.config.fieldElevationFt + geoid + aglFt,
    onGround: false,
    gs: 150,
    track: 90,
    verticalRateFpm: vr,
    seenPos: 0,
    type: null,
    typeDesc: null,
    registration: null,
  };
  return { ac, assignment: null };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useGpws readout", () => {
  it("fires a callout as the aircraft descends past a gate (audio not required)", () => {
    // Start just above 300 ft, descending — the readout should surface "300" without
    // any Audio (the visual reflects the data layer independently of playback).
    const { result } = renderHook(
      () => useGpws(item(310, -1200), { active: true, audible: false }),
      { wrapper },
    );
    expect(result.current.callout).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.callout).toBe("300");
  });

  it("stays silent when the cockpit sim is inactive", () => {
    const { result } = renderHook(
      () => useGpws(item(310, -1200), { active: false, audible: false }),
      { wrapper },
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.callout).toBeNull();
  });

  it("does not throw when the tracked aircraft is deselected mid-descent", () => {
    const { result, rerender } = renderHook(
      ({ it }: { it: AircraftWithAssignment | null }) =>
        useGpws(it, { active: true, audible: false }),
      { wrapper, initialProps: { it: item(310, -1200) as AircraftWithAssignment | null } },
    );
    act(() => vi.advanceTimersByTime(1500));
    // Deselect, then reselect the same aircraft — the engine must keep ticking cleanly.
    rerender({ it: null });
    act(() => vi.advanceTimersByTime(800));
    rerender({ it: item(120, -900) });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.callout).not.toBeNull();
  });
});
