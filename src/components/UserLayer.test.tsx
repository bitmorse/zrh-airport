import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import { UserLayer } from "./UserLayer";

const AP = buildAirport(ZRH);
const NEAR = { lat: 47.46, lon: 8.55 }; // on the ZRH map
const FAR = { lat: 49.0, lon: 8.55 }; // well off the map

function renderLayer(props: Parameters<typeof UserLayer>[0]) {
  return render(
    <svg>
      <AirportContext.Provider value={AP}>
        <UserLayer {...props} />
      </AirportContext.Provider>
    </svg>,
  );
}

afterEach(cleanup);

describe("UserLayer", () => {
  it("draws the geofence ring only while recording, plus the dot and heading cone", () => {
    const { container } = renderLayer({
      userPos: NEAR,
      heading: 90,
      radiusM: 3000,
      recording: true,
    });
    expect(container.querySelector("circle[stroke-dasharray]")).not.toBeNull(); // ring
    expect(container.querySelector("path")).not.toBeNull(); // facing cone
    expect(container.querySelectorAll("circle").length).toBeGreaterThanOrEqual(2); // ring + dot
  });

  it("hides the ring when not recording and the cone when heading is unknown", () => {
    const { container } = renderLayer({
      userPos: NEAR,
      heading: null,
      radiusM: 3000,
      recording: false,
    });
    expect(container.querySelector("circle[stroke-dasharray]")).toBeNull(); // no ring
    expect(container.querySelector("path")).toBeNull(); // no cone
    expect(container.querySelector("circle")).not.toBeNull(); // dot still there
  });

  it("omits the ring for an off-map observer (dot is clamped/dimmed instead)", () => {
    const { container } = renderLayer({
      userPos: FAR,
      heading: 90,
      radiusM: 3000,
      recording: true,
    });
    expect(container.querySelector("circle[stroke-dasharray]")).toBeNull();
    expect(container.querySelector("g[opacity='0.5']")).not.toBeNull(); // dimmed marker
  });
});
