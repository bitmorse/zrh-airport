import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { byRunway, summarize, type MovementLog } from "../domain/movementStats";
import { MovementsByHour } from "./MovementsByHour";

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);

const log: MovementLog = {
  "2026-07-20T14": { "28": { l: 2, t: 1 }, "16": { l: 0, t: 3 } },
  "2026-07-19T14": { "28": { l: 4, t: 3 } },
  "2026-07-20T09": { "28": { l: 1, t: 0 } },
};

// The component now takes pre-aggregated histograms (from the stats API or the
// local log); build them from the fixture the same way App does.
const runways = byRunway(log);
const summary = summarize(log);
const emptySummary = { landings: 0, takeoffs: 0, days: 0 };

afterEach(cleanup);

describe("MovementsByHour", () => {
  it("shows an empty state before any history is collected", () => {
    render(<MovementsByHour runways={[]} summary={emptySummary} timeZone="UTC" now={NOW} />);
    expect(screen.getByText("Traffic by hour")).toBeInTheDocument();
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });

  it("renders one chart per runway with a labelled, ticked Y axis and a summary", () => {
    render(
      <MovementsByHour runways={runways} summary={summary} timeZone="Europe/Zurich" now={NOW} />,
    );

    // A separate chart per runway end (busiest first) — split, not aggregated.
    expect(screen.getByRole("img", { name: /Runway 28/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Runway 16/i })).toBeInTheDocument();
    expect(screen.getAllByText("RWY").length).toBeGreaterThanOrEqual(2);

    // Y axis: a units label and numeric ticks (0 appears on every chart).
    expect(screen.getByText(/movements \/ day/)).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);

    // Overall summary across runways: 7 landings, 7 takeoffs, 2 days.
    expect(screen.getByText(/7 landings · 7 takeoffs over 2 days/)).toBeInTheDocument();
    expect(screen.getByText(/Zurich local time/)).toBeInTheDocument();
  });

  it("toggles the Y axis between average-per-day and all-time totals", () => {
    render(<MovementsByHour runways={runways} summary={summary} timeZone="UTC" now={NOW} />);
    expect(screen.getByText(/movements \/ day/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Total" }));
    expect(screen.getByText(/movements \(total\)/)).toBeInTheDocument();
  });
});
