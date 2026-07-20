import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { byRunway, summarize, type MovementLog } from "../domain/movementStats";
import { MovementsByHour, type StatView } from "./MovementsByHour";

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

function renderMbh(view: StatView, onViewChange: (v: StatView) => void = () => {}, tz = "UTC") {
  return render(
    <MovementsByHour
      runways={runways}
      summary={summary}
      timeZone={tz}
      now={NOW}
      view={view}
      onViewChange={onViewChange}
      dow={2}
      onDowChange={() => {}}
    />,
  );
}

describe("MovementsByHour", () => {
  it("shows an empty state before any history is collected", () => {
    render(
      <MovementsByHour
        runways={[]}
        summary={emptySummary}
        timeZone="UTC"
        now={NOW}
        view="today"
        onViewChange={() => {}}
        dow={2}
        onDowChange={() => {}}
      />,
    );
    expect(screen.getByText("Traffic by hour")).toBeInTheDocument();
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });

  it("renders one chart per runway with a labelled Y axis and a summary", () => {
    renderMbh("usual", () => {}, "Europe/Zurich");

    // A separate chart per runway end (busiest first) — split, not aggregated.
    expect(screen.getByRole("img", { name: /Runway 28/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Runway 16/i })).toBeInTheDocument();
    expect(screen.getAllByText("RWY").length).toBeGreaterThanOrEqual(2);

    // "Usual" view averages per day.
    expect(screen.getByText(/movements \/ day/)).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText(/7 landings · 7 takeoffs over 2 days/)).toBeInTheDocument();
    expect(screen.getByText(/Zurich local time/)).toBeInTheDocument();
  });

  it("defaults to Today (real last-24 h counts) and reports the view change", () => {
    const onViewChange = vi.fn();
    renderMbh("today", onViewChange);
    expect(screen.getByText(/movements · last 24 h/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");

    // Controlled toggle: clicking "Usual" asks the parent to switch.
    fireEvent.click(screen.getByRole("button", { name: "Usual" }));
    expect(onViewChange).toHaveBeenCalledWith("usual");
  });

  it("shows a weekday picker only in the Usual view and reports changes", () => {
    const onDowChange = vi.fn();
    const { rerender } = render(
      <MovementsByHour
        runways={runways}
        summary={summary}
        timeZone="UTC"
        now={NOW}
        view="today"
        onViewChange={() => {}}
        dow={2}
        onDowChange={onDowChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Fri" })).toBeNull(); // hidden in Today

    rerender(
      <MovementsByHour
        runways={runways}
        summary={summary}
        timeZone="UTC"
        now={NOW}
        view="usual"
        onViewChange={() => {}}
        dow={2}
        onDowChange={onDowChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fri" }));
    expect(onDowChange).toHaveBeenCalledWith(5); // Fri = index 5
  });
});
