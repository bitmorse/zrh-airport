import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MovementLog } from "../domain/movementStats";
import { MovementsByHour } from "./MovementsByHour";

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);

afterEach(cleanup);

describe("MovementsByHour", () => {
  it("shows an empty state before any history is collected", () => {
    render(<MovementsByHour log={{}} timeZone="UTC" now={NOW} />);
    expect(screen.getByText("Traffic by hour")).toBeInTheDocument();
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });

  it("renders the chart and a summary once there is history", () => {
    const log: MovementLog = {
      "2026-07-20T14": { l: 2, t: 1 },
      "2026-07-19T14": { l: 4, t: 3 },
      "2026-07-20T09": { l: 1, t: 0 },
    };
    render(<MovementsByHour log={log} timeZone="Europe/Zurich" now={NOW} />);

    // Legend + a summary line totalling 7 landings, 4 takeoffs over 2 days.
    expect(screen.getByText("landings")).toBeInTheDocument();
    expect(screen.getByText(/7 landings · 4 takeoffs over 2 days/)).toBeInTheDocument();
    expect(screen.getByText(/Zurich local time/)).toBeInTheDocument();

    // A per-hour bar carries an accessible title with the counts.
    expect(screen.getByTitle(/14:00 —/)).toBeInTheDocument();
  });

  it("toggles between average-per-day and all-time totals", () => {
    const log: MovementLog = { "2026-07-20T14": { l: 2, t: 1 }, "2026-07-19T14": { l: 4, t: 3 } };
    render(<MovementsByHour log={log} timeZone="UTC" now={NOW} />);

    // Default: average per day → the 14:00 bar reads "per day".
    expect(screen.getByTitle(/^14:00 —.*per day/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Total" }));
    // Totals mode → the 14:00 bar shows the summed 6 landings · 4 takeoffs.
    expect(screen.getByTitle("14:00 — 6 landings · 4 takeoffs")).toBeInTheDocument();
  });
});
