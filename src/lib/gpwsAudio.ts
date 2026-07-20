/**
 * GPWS callout audio engine, built for mobile Safari reliability.
 *
 * Uses `HTMLAudioElement` (not Web Audio): the clips are cross-origin `.wav`s, and a
 * media element plays cross-origin WITHOUT CORS, whereas `fetch`+`decodeAudioData`
 * needs it — so media elements are the only thing guaranteed to sound at all here.
 *
 * The two mobile-Safari failure modes are handled explicitly:
 *   - iOS blesses a media element for scripted playback only once it has been played
 *     inside a user gesture. We prime every clip on the FIRST tap anywhere (not just the
 *     speaker button), and re-arm that priming after the page is backgrounded (a lock
 *     drops the blessing).
 *   - a clip interrupted mid-play (screen lock) never fires `ended`, which would jam the
 *     serial queue forever. A per-clip watchdog advances the queue regardless.
 *
 * Globals (`Audio`, `document`) are resolved at call time, so a jsdom/test environment
 * without them makes every method a safe no-op and the visual readout carries the data
 * layer on its own.
 */
import { GPWS_SCHEDULE } from "../domain/gpws";

const elements = new Map<string, HTMLAudioElement>();
let queue: string[] = [];
let current: HTMLAudioElement | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let lifecycleBound = false;
let gestureArmed = false;

function hasAudio(): boolean {
  return typeof Audio !== "undefined";
}

// Bless every cached clip for later scripted playback. iOS grants the blessing when an
// element is played inside a user gesture; play→immediate-pause is silent but counts.
function primeAll(): void {
  for (const a of elements.values()) {
    try {
      const p = a.play();
      a.pause();
      a.currentTime = 0;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* not ready — retried on the next gesture */
    }
  }
}

function armGesture(): void {
  if (gestureArmed || typeof document === "undefined") return;
  gestureArmed = true;
  const handler = () => {
    gestureArmed = false;
    document.removeEventListener("pointerdown", handler, { capture: true });
    document.removeEventListener("touchend", handler, { capture: true });
    primeAll();
  };
  document.addEventListener("pointerdown", handler, { capture: true });
  document.addEventListener("touchend", handler, { capture: true });
}

function bindLifecycle(): void {
  armGesture(); // prime on the first tap anywhere, even if the speaker is never tapped
  if (lifecycleBound || typeof document === "undefined") return;
  lifecycleBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") armGesture(); // re-bless after a lock
  });
}

/** Create one preloaded `<audio>` per callout url. Cross-origin playback needs no CORS. */
export function load(urls: string[] = GPWS_SCHEDULE.map((c) => c.url)): void {
  if (!hasAudio()) return;
  for (const url of urls) {
    if (!elements.has(url)) {
      const a = new Audio(url);
      a.preload = "auto";
      elements.set(url, a);
    }
  }
  bindLifecycle();
}

/** Prime playback from a user gesture (the speaker tap). Idempotent. */
export function unlock(): void {
  if (!hasAudio()) return;
  bindLifecycle();
  primeAll();
}

function clearWatchdog(): void {
  if (watchdog != null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

function playNext(): void {
  if (current) return;
  const url = queue.shift();
  if (!url) return;
  const a = elements.get(url);
  if (!a) {
    playNext();
    return;
  }
  current = a;
  a.currentTime = 0;
  const done = () => {
    a.removeEventListener("ended", done);
    clearWatchdog();
    if (current === a) current = null;
    playNext();
  };
  a.addEventListener("ended", done);
  // Watchdog: a clip interrupted mid-play (phone locked) never fires `ended`, so advance
  // after its duration regardless — the queue can then never jam permanently.
  const capMs = (Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : 4000) + 800;
  watchdog = setTimeout(done, capMs);
  const p = a.play();
  if (p && typeof p.catch === "function") p.catch(() => done()); // blocked/failed — skip on
}

/** Queue a callout for serial playback (never overlaps the previous one). */
export function play(url: string): void {
  if (!hasAudio()) return;
  queue.push(url);
  playNext();
}

/** Cut any pending/playing callouts (mute, or switching aircraft). */
export function stopAll(): void {
  clearWatchdog();
  queue = [];
  if (current) {
    try {
      current.pause();
    } catch {
      /* ignore */
    }
    current = null;
  }
}

/** Test-only: reset the singleton between tests. */
export function __resetForTest(): void {
  clearWatchdog();
  elements.clear();
  queue = [];
  current = null;
  lifecycleBound = false;
  gestureArmed = false;
}
