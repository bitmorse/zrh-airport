import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ZRH } from "../data/airports";
import { WorldBasemap } from "./WorldBasemap";

afterEach(cleanup);

describe("WorldBasemap", () => {
  it("projects the country outlines into a single path once the geojson loads", async () => {
    const { container } = render(
      <svg>
        <WorldBasemap arp={ZRH.arp} />
      </svg>,
    );
    // The GeoJSON is dynamically imported, so the path appears asynchronously.
    await waitFor(() => {
      const path = container.querySelector("path");
      expect(path).not.toBeNull();
      expect(path?.getAttribute("d")?.length ?? 0).toBeGreaterThan(100);
    });
  });
});
