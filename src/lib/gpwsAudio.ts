/**
 * GPWS callout audio engine — Web Audio API, built for mobile Safari.
 *
 * Why Web Audio (not <audio> elements): iOS drops a media element's playback permission
 * on every interruption (screen lock, call), so timer-started playback silently fails,
 * and an element interrupted mid-clip never fires "ended" and jams a serial queue. A
 * single AudioContext fixes both: unlocked once inside a user gesture, auto-resumed on
 * wake (visibility / any touch), and callouts scheduled on the context clock so nothing
 * stalls. This needs the clips same-origin (fetch + decodeAudioData) — they're vendored
 * in public/audio/gpws/, so there's no CORS wall.
 *
 * The module is a lazily-created singleton. Globals (`AudioContext`, `fetch`) are
 * resolved at call time, so a jsdom/test environment without them makes every method a
 * safe no-op and the visual callout readout carries the data layer on its own.
 */
import { GPWS_SCHEDULE } from "../domain/gpws";

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let gain: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();
const scheduled = new Set<AudioBufferSourceNode>();
let nextAt = 0; // context-clock time the next callout may start (serialises playback)
let lifecycleBound = false; // visibility/focus listeners attached once
let gestureArmed = false; // one-shot "unlock/resume on next touch" armed?

function AudioCtor(): typeof AudioContext | null {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function getFetch(): typeof fetch | null {
  return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
}

/** True once the context is actively playing. "suspended"/"interrupted" both count as not. */
function isRunning(): boolean {
  return ctx?.state === "running";
}

function resume(): void {
  ctx?.resume?.().catch(() => {
    /* will retry on the next gesture / visibility change */
  });
}

// Prime/resume on the next touch ANYWHERE, inside a real gesture — so audio unlocks on
// first interaction (not only the speaker button) and can never stay dead after a wake.
// Armed at startup and whenever the context drops; disarms itself on the first event.
function armGesture(): void {
  if (gestureArmed || typeof document === "undefined") return;
  gestureArmed = true;
  const handler = () => {
    gestureArmed = false;
    document.removeEventListener("pointerdown", handler, { capture: true });
    document.removeEventListener("touchend", handler, { capture: true });
    unlock();
  };
  document.addEventListener("pointerdown", handler, { capture: true });
  document.addEventListener("touchend", handler, { capture: true });
}

function bindLifecycle(): void {
  armGesture(); // prime on the first tap anywhere, even before the speaker is touched
  if (lifecycleBound || typeof document === "undefined") return;
  lifecycleBound = true;
  const onWake = () => {
    if (!isRunning()) {
      resume();
      armGesture(); // if resume alone doesn't take, the next tap re-unlocks
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onWake();
  });
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
  }
}

function ensureCtx(): Ctx | null {
  if (ctx) return ctx;
  const Ctor = AudioCtor();
  if (!Ctor) return null;
  ctx = new Ctor();
  gain = ctx.createGain();
  gain.connect(ctx.destination);
  nextAt = ctx.currentTime;
  ctx.addEventListener?.("statechange", () => {
    if (isRunning()) {
      nextAt = ctx!.currentTime; // re-baseline so a wake doesn't dump a stale backlog
    } else {
      armGesture(); // dropped (locked/suspended) — guarantee a recovery path
    }
  });
  bindLifecycle();
  return ctx;
}

/**
 * Unlock/resume the context from inside a user gesture (the speaker tap, or the first
 * touch anywhere). Plays a 1-frame silent buffer to satisfy older WebKit that needs
 * actual output in-gesture, then resumes. Idempotent — safe to call on every tap.
 */
export function unlock(): void {
  const c = ensureCtx();
  if (!c) return;
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* createBuffer unsupported — resume alone still unlocks on modern Safari */
  }
  resume();
}

/** Fetch + decode each url once into an AudioBuffer. Never throws; retries next call. */
export function load(urls: string[] = GPWS_SCHEDULE.map((c) => c.url)): void {
  const c = ensureCtx();
  const doFetch = getFetch();
  if (!c || !doFetch) return; // unsupported env (e.g. jsdom) — label-only
  for (const url of urls) {
    if (buffers.has(url) || loading.has(url)) continue;
    const p = doFetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => c.decodeAudioData(buf))
      .then((decoded) => {
        buffers.set(url, decoded);
      })
      .catch(() => {
        /* transient network/decode failure — drop from `loading` so a later call retries */
      })
      .finally(() => {
        loading.delete(url);
      });
    loading.set(url, p);
  }
}

/**
 * Play a callout. Returns true if it was scheduled. Callouts are serialised on the
 * context clock (`nextAt`), so they never overlap and there is no "ended" chain to
 * stall. While the context isn't running we resume eagerly and skip scheduling — the
 * visual readout still fires, and we avoid a burst of stale callouts on wake.
 */
export function play(url: string): boolean {
  const c = ensureCtx();
  if (!c || !gain) return false;
  if (!isRunning()) {
    resume();
    return false;
  }
  const buf = buffers.get(url);
  if (!buf) {
    load([url]); // not decoded yet — kick a load for next time
    return false;
  }
  const start = Math.max(c.currentTime, nextAt);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.onended = () => {
    scheduled.delete(src);
  };
  src.start(start);
  scheduled.add(src);
  nextAt = start + buf.duration;
  return true;
}

/** Cut all pending/playing callouts (mute, or switching aircraft) and reset the clock. */
export function stopAll(): void {
  for (const src of scheduled) {
    try {
      src.stop();
    } catch {
      /* already stopped/ended */
    }
  }
  scheduled.clear();
  nextAt = ctx ? ctx.currentTime : 0;
}

/** Test-only: tear down the singleton so each test starts clean. */
export function __resetForTest(): void {
  ctx = null;
  gain = null;
  buffers.clear();
  loading.clear();
  scheduled.clear();
  nextAt = 0;
  lifecycleBound = false;
  gestureArmed = false;
}
