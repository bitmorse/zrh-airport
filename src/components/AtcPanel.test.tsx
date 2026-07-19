import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAirport } from "../domain/airport";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import { ZRH } from "../data/airports";
import { AirportContext } from "../hooks/useAirport";
import { AtcPanel } from "./AtcPanel";

const AP = buildAirport(ZRH);

function renderPanel(
  arrivals: Arrival[],
  departures: DepartureEvent[],
  onSelect = vi.fn(),
) {
  return {
    onSelect,
    ...render(
      <AirportContext.Provider value={AP}>
        <AtcPanel arrivals={arrivals} departures={departures} now={1_000_000} onSelect={onSelect} />
      </AirportContext.Provider>,
    ),
  };
}

const arrival: Arrival = {
  end: "34",
  strip: "16/34",
  hex: "aaa",
  callsign: "SWR123",
  etaSeconds: 60,
  distanceNm: 3,
  gsKt: 150,
};

beforeEach(() => {
  localStorage.clear();
  // jsdom has no media element playback; stub it.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AtcPanel", () => {
  it("renders a row per ATC position with a disabled play until a URL is pasted", () => {
    renderPanel([arrival], []);
    for (const label of ["Approach", "Tower", "Departure", "Ground"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const play = screen.getByRole("button", { name: /Play Tower/i });
    expect(play).toBeDisabled();
  });

  it("plays a feed after a URL is entered and shows who's on frequency", async () => {
    const { onSelect } = renderPanel([arrival], []);
    fireEvent.change(screen.getByLabelText("Tower stream URL"), {
      target: { value: "https://example.com/lszh_twr" },
    });
    const play = screen.getByRole("button", { name: /Play Tower/i });
    expect(play).toBeEnabled();
    fireEvent.click(play);

    // Active runway (from ADS-B) and the candidate aircraft appear.
    expect(await screen.findByText(/active 34/)).toBeInTheDocument();
    const candidate = screen.getByRole("button", { name: /SWR123/ });
    fireEvent.click(candidate);
    expect(onSelect).toHaveBeenCalledWith("aaa");
  });
});
