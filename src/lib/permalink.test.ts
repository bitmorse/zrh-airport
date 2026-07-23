import { afterEach, describe, expect, it } from "vitest";
import { readInitialLink, writeAirportLink, writeFollowLink } from "./permalink";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("readInitialLink", () => {
  it("reads a follow query from flight/hex/reg and the airport", () => {
    expect(readInitialLink("?flight=LX40")).toEqual({ airport: null, followQuery: "LX40" });
    expect(readInitialLink("?hex=4b1620")).toEqual({ airport: null, followQuery: "4b1620" });
    expect(readInitialLink("?reg=HB-JCA&airport=LSZH")).toEqual({
      airport: "LSZH",
      followQuery: "HB-JCA",
    });
    expect(readInitialLink("?airport=LSGG")).toEqual({ airport: "LSGG", followQuery: null });
    expect(readInitialLink("")).toEqual({ airport: null, followQuery: null });
  });
});

describe("writeFollowLink / writeAirportLink", () => {
  it("classifies the query into the right param and round-trips", () => {
    writeFollowLink("AI136");
    expect(window.location.search).toBe("?flight=AI136");
    expect(readInitialLink(window.location.search).followQuery).toBe("AI136");

    writeFollowLink("HB-JCA");
    expect(window.location.search).toBe("?reg=HB-JCA");

    writeFollowLink("4b1620");
    expect(window.location.search).toBe("?hex=4b1620");
  });

  it("writeAirportLink keeps only the airport (or clears)", () => {
    writeAirportLink("LSZH");
    expect(window.location.search).toBe("?airport=LSZH");
    writeAirportLink(null);
    expect(window.location.search).toBe("");
  });
});
