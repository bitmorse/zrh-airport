import { describe, expect, it } from "vitest";
import { embedUrl, isSdrMessage, receiverOrigin } from "./airportSdr";

describe("receiverOrigin", () => {
  it("returns the origin, dropping any path", () => {
    expect(receiverOrigin("https://ridge.tailed0c2.ts.net/anything")).toBe(
      "https://ridge.tailed0c2.ts.net",
    );
  });
  it("returns null for a non-URL", () => {
    expect(receiverOrigin("not a url")).toBeNull();
    expect(receiverOrigin("")).toBeNull();
  });
});

describe("embedUrl", () => {
  it("builds /embed/<channel> with the encoded channel and our origin", () => {
    expect(embedUrl("https://r.example/", "Apron S", "https://site.example")).toBe(
      "https://r.example/embed/Apron%20S?origin=https%3A%2F%2Fsite.example",
    );
  });
});

describe("isSdrMessage", () => {
  it("accepts only airport-sdr protocol-1 messages", () => {
    expect(isSdrMessage({ source: "airport-sdr", protocol: 1, type: "ready" })).toBe(true);
    expect(isSdrMessage({ source: "airport-sdr", protocol: 2, type: "ready" })).toBe(false);
    expect(isSdrMessage({ source: "other", protocol: 1, type: "ready" })).toBe(false);
    expect(isSdrMessage(null)).toBe(false);
    expect(isSdrMessage({ type: "ready" })).toBe(false);
  });
});
