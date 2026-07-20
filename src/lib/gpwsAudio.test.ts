import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gpwsAudio from "./gpwsAudio";

// --- Fake HTMLAudioElement, injected via globalThis.Audio -------------------

let instances: FakeAudio[] = [];

class FakeAudio {
  src: string;
  preload = "";
  currentTime = 0;
  duration = 1.2;
  private listeners: Record<string, Array<() => void>> = {};
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  addEventListener = vi.fn((ev: string, cb: () => void) => {
    (this.listeners[ev] ??= []).push(cb);
  });
  removeEventListener = vi.fn((ev: string, cb: () => void) => {
    this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== cb);
  });
  constructor(src: string) {
    this.src = src;
    instances.push(this);
  }
  emit(ev: string) {
    for (const cb of this.listeners[ev] ?? []) cb();
  }
}

beforeEach(() => {
  instances = [];
  (globalThis as Record<string, unknown>).Audio = FakeAudio as unknown;
  gpwsAudio.__resetForTest();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Audio;
});

describe("gpwsAudio", () => {
  it("load() creates one preloaded element per url and dedups", () => {
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.load(["a.wav"]); // already loaded → no new element
    expect(instances.length).toBe(2);
    expect(instances.every((a) => a.preload === "auto")).toBe(true);
  });

  it("plays callouts serially, advancing on ended", () => {
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.play("a.wav");
    gpwsAudio.play("b.wav");
    const [a, b] = instances;
    expect(a.play).toHaveBeenCalled();
    expect(b.play).not.toHaveBeenCalled(); // waits for a to end
    a.emit("ended");
    expect(b.play).toHaveBeenCalled();
  });

  it("watchdog advances the queue if a clip never fires ended (interrupted)", () => {
    vi.useFakeTimers();
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.play("a.wav");
    gpwsAudio.play("b.wav");
    const [a, b] = instances;
    expect(a.play).toHaveBeenCalled();
    expect(b.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1.2 * 1000 + 800 + 10); // past the watchdog cap
    expect(b.play).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stopAll() pauses the current clip and clears the queue", () => {
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.play("a.wav");
    gpwsAudio.play("b.wav");
    const [a, b] = instances;
    gpwsAudio.stopAll();
    expect(a.pause).toHaveBeenCalled();
    // Queue cleared → a fresh play starts immediately, the stale "b" was dropped.
    gpwsAudio.play("a.wav");
    expect(a.play).toHaveBeenCalledTimes(2);
    expect(b.play).not.toHaveBeenCalled();
  });

  it("unlock() primes every element (play → pause) inside the gesture", () => {
    gpwsAudio.load(["a.wav", "b.wav"]);
    gpwsAudio.unlock();
    for (const a of instances) {
      expect(a.play).toHaveBeenCalled();
      expect(a.pause).toHaveBeenCalled();
    }
  });

  it("primes on the first pointer gesture anywhere, without a speaker tap", () => {
    gpwsAudio.load(["a.wav"]);
    expect(instances[0].play).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("pointerdown"));
    expect(instances[0].play).toHaveBeenCalled();
  });

  it("is a safe no-op when Audio is unavailable", () => {
    delete (globalThis as Record<string, unknown>).Audio;
    gpwsAudio.__resetForTest();
    expect(() => {
      gpwsAudio.load(["a.wav"]);
      gpwsAudio.unlock();
      gpwsAudio.play("a.wav");
      gpwsAudio.stopAll();
    }).not.toThrow();
  });
});
