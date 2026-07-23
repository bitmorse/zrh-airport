import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { Plane } from "./Plane";

afterEach(cleanup);

const AP = buildAirport(ZRH);

// ~500 km north of Zürich — well outside the ±25 km field world (would normally be culled).
const far: AircraftWithAssignment = {
  ac: { hex: "abc123", flight: "OS146", lat: 51.96, lon: 8.55, onGround: false, track: 180 } as Aircraft,
  assignment: null,
};

function renderPlane(props: Parameters<typeof Plane>[0]) {
  return render(
    <AirportContext.Provider value={AP}>
      <svg>
        <Plane {...props} />
      </svg>
    </AirportContext.Provider>,
  );
}

describe("Plane", () => {
  it("culls a distant, unselected aircraft", () => {
    const { container } = renderPlane({ item: far });
    expect(container.querySelector("path")).toBeNull();
  });

  it("still draws a distant aircraft once it's selected (search reveal)", () => {
    const { container } = renderPlane({ item: far, selected: true });
    expect(container.querySelector("path")).not.toBeNull(); // the glyph survives the cull
  });

  it("adds an accent ring for the searched flight", () => {
    const { container } = renderPlane({ item: far, selected: true, searched: true });
    expect(container.querySelector("circle[r='13']")).not.toBeNull();
  });

  it("dashes the target box when the position is estimated", () => {
    const { container } = renderPlane({ item: far, selected: true, searched: true, estimated: true });
    const rect = container.querySelector("rect");
    expect(rect?.getAttribute("stroke-dasharray")).toBe("3 3");
  });
});
