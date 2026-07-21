import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gpwsAudio from "./gpwsAudio";

// --- Minimal fake Web Audio + fetch, injected via globals -------------------

const BUF_DUR = 1.2;

class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect = vi.fn();
  start = vi.fn((t: number) => {
    this.startedAt = t;
  });
  stop = vi.fn(() => {
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
  });
}

class FakeAudioContext extends EventTarget {
  state: "suspended" | "running" | "interrupted" = "suspended";
  currentTime = 0;
  destination = {};
  sources: FakeBufferSource[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  });
  createGain = vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } }));
  createBuffer = vi.fn(() => ({ duration: 0 }));
  createBufferSource = vi.fn(() => {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  });
  decodeAudioData = vi.fn(async () => ({ duration: BUF_DUR }) as unknown as AudioBuffer);
  setState(s: "suspended" | "running" | "interrupted") {
    this.state = s;
    this.dispatchEvent(new Event("statechange"));
  }
}

let fakeCtx: FakeAudioContext;

beforeEach(() => {
  fakeCtx = new FakeAudioContext();
  // Return the same instance so the singleton and the test share one context.
  (globalThis as Record<string, unknown>).AudioContext = vi.fn(() => fakeCtx);
  (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
  gpwsAudio.__resetForTest();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).fetch;
});

/** Decode every queued load so buffers are ready (drains the fetch→decode microtasks). */
async function flushLoads() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("gpwsAudio", () => {
  it("load() decodes each url once and dedups concurrent loads", async () => {
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.load(["a.wav"]); // already loading → no extra fetch
    await flushLoads();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(fakeCtx.decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it("unlock() resumes the context and plays a priming buffer", () => {
    gpwsAudio.unlock();
    expect(fakeCtx.resume).toHaveBeenCalled();
    expect(fakeCtx.state).toBe("running");
    expect(fakeCtx.sources.length).toBe(1); // the 1-frame silent buffer
  });

  it("play() while not running schedules nothing but kicks a resume", () => {
    // suspended by default
    expect(gpwsAudio.play("a.wav")).toBe(false);
    expect(fakeCtx.resume).toHaveBeenCalled();
  });

  it("play() with no buffer returns false and kicks a load", () => {
    gpwsAudio.unlock(); // running now
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(gpwsAudio.play("missing.wav")).toBe(false);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it("serialises callouts on the context clock across ticks", async () => {
    gpwsAudio.unlock(); // running
    gpwsAudio.load(["a.wav", "b.wav", "c.wav"]);
    await flushLoads();

    // Three cues, played across separate ticks — each starts after the previous ends.
    expect(gpwsAudio.play("a.wav")).toBe(true);
    expect(gpwsAudio.play("b.wav")).toBe(true);
    expect(gpwsAudio.play("c.wav")).toBe(true);

    const starts = fakeCtx.sources
      .filter((s) => s.buffer && (s.buffer as { duration: number }).duration === BUF_DUR)
      .map((s) => s.startedAt);
    expect(starts).toEqual([0, BUF_DUR, 2 * BUF_DUR]);
  });

  it("collapses a stale nextAt against the live clock", async () => {
    gpwsAudio.unlock();
    gpwsAudio.load(["a.wav"]);
    await flushLoads();
    gpwsAudio.play("a.wav"); // nextAt → BUF_DUR
    fakeCtx.currentTime = 100; // long real gap
    gpwsAudio.play("a.wav");
    const last = fakeCtx.sources.at(-1)!;
    expect(last.startedAt).toBe(100); // max(currentTime, nextAt)
  });

  it("stopAll() stops every scheduled source and resets the clock", async () => {
    gpwsAudio.unlock();
    fakeCtx.currentTime = 5;
    gpwsAudio.load(["a.wav", "b.wav"]);
    await flushLoads();
    gpwsAudio.play("a.wav");
    gpwsAudio.play("b.wav");
    const played = fakeCtx.sources.filter((s) => (s.buffer as { duration: number })?.duration === BUF_DUR);
    gpwsAudio.stopAll();
    for (const s of played) expect(s.stop).toHaveBeenCalled();
    // Next callout starts from currentTime again, not the old accumulated nextAt.
    gpwsAudio.play("a.wav");
    expect(fakeCtx.sources.at(-1)!.startedAt).toBe(5);
  });

  it("resumes when the tab becomes visible after being interrupted", () => {
    gpwsAudio.unlock(); // running, binds lifecycle listeners
    fakeCtx.resume.mockClear();
    fakeCtx.setState("interrupted"); // e.g. phone locked
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fakeCtx.resume).toHaveBeenCalled();
  });

  it("is a safe no-op when Web Audio is unavailable", () => {
    delete (globalThis as Record<string, unknown>).AudioContext;
    gpwsAudio.__resetForTest();
    expect(() => {
      gpwsAudio.load(["a.wav"]);
      gpwsAudio.unlock();
      gpwsAudio.stopAll();
    }).not.toThrow();
    expect(gpwsAudio.play("a.wav")).toBe(false);
  });
});
