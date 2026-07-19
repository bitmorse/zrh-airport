import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import { TrafficBar } from "./TrafficBar";

// Route lookup hits the network and needs react-query; stub it for a pure UI test.
vi.mock("../hooks/useFlightRoute", () => ({
  useFlightRoute: () => ({ data: null, isLoading: false, isError: false }),
}));

const NOW = 1_000_000;

const arrival: Arrival = {
  end: "34",
  strip: "16/34",
  hex: "arr1",
  callsign: "SWR40L",
  etaSeconds: 90,
  distanceNm: 4,
  gsKt: 150,
};

function holding(hex: string, callsign: string, sinceMs: number): DepartureEvent {
  return { end: "28", strip: "10/28", hex, callsign, phase: "holding", gsKt: 0, holdingSinceMs: sinceMs };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("TrafficBar", () => {
  it("renders a departure in the same row format (no chips) with a live timer", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TrafficBar
        arrivals={[arrival]}
        departures={[holding("d1", "THA936", NOW - 37_000)]}
        now={NOW}
        lastUpdated={NOW}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("SWR40L")).toBeInTheDocument(); // arrival row
    expect(screen.getByText(/waiting/)).toBeInTheDocument(); // departure state
    expect(screen.getByText("0:37")).toBeInTheDocument(); // live wait timer

    // No pill/ring/background chip styling survives on any row.
    expect(container.querySelectorAll('[class*="ring-"]').length).toBe(0);
    expect(container.querySelector('[class*="bg-amber"]')).toBeNull();

    fireEvent.click(screen.getByText("THA936"));
    expect(onSelect).toHaveBeenCalledWith("d1");
  });

  it("flashes 'decision height' while the crossing is recent, then stops", () => {
    const { rerender } = render(
      <TrafficBar
        arrivals={[{ ...arrival, dhAtMs: NOW - 2000 }]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.getByText(/decision height/)).toBeInTheDocument();

    rerender(
      <TrafficBar
        arrivals={[{ ...arrival, dhAtMs: NOW - 10_000 }]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.queryByText(/decision height/)).toBeNull();
  });

  it("caps the list at 3 departures and shows a '+N more' line", () => {
    render(
      <TrafficBar
        arrivals={[]}
        departures={[
          holding("d0", "DEP0", NOW),
          holding("d1", "DEP1", NOW),
          holding("d2", "DEP2", NOW),
          holding("d3", "DEP3", NOW),
          holding("d4", "DEP4", NOW),
        ]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.getByText("No inbound traffic")).toBeInTheDocument();
    expect(screen.getByText("DEP0")).toBeInTheDocument();
    expect(screen.getByText("DEP2")).toBeInTheDocument();
    expect(screen.queryByText("DEP3")).toBeNull();
    expect(screen.getByText("+2 more departing")).toBeInTheDocument();
  });
});
