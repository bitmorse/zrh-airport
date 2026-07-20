import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import { AirportSvg } from "./AirportSvg";

const AP = buildAirport(ZRH);

function renderMap(props: Partial<Parameters<typeof AirportSvg>[0]> = {}) {
  return render(
    <AirportContext.Provider value={AP}>
      <AirportSvg aircraft={[]} counts={{}} lastUpdated={null} {...props} />
    </AirportContext.Provider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("AirportSvg location control", () => {
  it("renders the 'my location' button and fires onLocate when tapped", () => {
    const onLocate = vi.fn();
    renderMap({ onLocate });
    const btn = screen.getByRole("button", { name: /Show my location/i });
    fireEvent.click(btn);
    expect(onLocate).toHaveBeenCalledTimes(1);
  });

  it("draws the user marker once a position is supplied", () => {
    const { container } = renderMap({
      onLocate: () => {},
      userPosition: { lat: 47.46, lon: 8.55 },
      heading: 45,
      fenceRadiusM: 3000,
      recording: true,
    });
    // The geofence ring (dashed circle) from UserLayer is present in the SVG.
    expect(container.querySelector("circle[stroke-dasharray]")).not.toBeNull();
  });
});
