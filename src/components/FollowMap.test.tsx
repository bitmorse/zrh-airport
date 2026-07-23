import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { FollowMap } from "./FollowMap";

const ac = (over: Partial<Aircraft> = {}): Aircraft =>
  ({ hex: "4b1620", flight: "LX40", lat: 47, lon: 8, track: 90, onGround: false, ...over }) as Aircraft;

afterEach(cleanup);

describe("FollowMap", () => {
  it("renders the world map svg", () => {
    render(<FollowMap aircraft={null} route={null} lastUpdated={null} />);
    expect(screen.getByRole("img", { name: /following the tracked flight/i })).toBeInTheDocument();
  });

  it("draws the aircraft glyph when a plane is present, and none while searching", () => {
    const { container, rerender } = render(
      <FollowMap aircraft={ac()} route={null} lastUpdated={Date.now()} />,
    );
    // The plane glyph is the only filled status-arrival path.
    expect(container.querySelector('path[fill="var(--color-status-arrival)"]')).not.toBeNull();

    rerender(<FollowMap aircraft={null} route={null} lastUpdated={null} />);
    expect(container.querySelector('path[fill="var(--color-status-arrival)"]')).toBeNull();
  });
});
