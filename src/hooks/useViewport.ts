import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fitPoints,
  isPointVisible,
  normalizeView,
  panBy,
  REVEAL_MAX_ZOOM,
  viewBoxString,
  zoomAtPoint,
  type ViewState,
} from "../lib/viewport";
import { useSettings } from "./useSettings";

const WHEEL_STEP = 1.12;
const BUTTON_STEP = 1.5;
const PERSIST_DELAY = 400;

interface Viewport {
  viewBox: string;
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /**
   * Reveal `target`, framing it with `context` (e.g. the field), adapting the zoom in
   * *or* out toward a comfortable framing and animating there. Always reframes — the
   * caller decides when to call it (on selection / on drift off-screen).
   */
  focusOn: (target: Pt, context?: Pt) => void;
  /** Recenter (and adaptively zoom) on `target`, animated. */
  centerOn: (target: Pt) => void;
  /** Is `target` comfortably within the live view right now? */
  isTargetVisible: (target: Pt) => boolean;
  isDragging: boolean;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Zoom/pan controller for the map SVG. Supports desktop wheel + buttons and touch
 * drag-to-pan / two-finger pinch-to-zoom. State is seeded from persisted settings
 * and written back (throttled) so zoom + pan survive reloads. `svgRef` maps screen
 * coordinates into the viewport.
 */
export function useViewport(
  svgRef: React.RefObject<SVGSVGElement | null>,
  onInteract?: () => void,
): Viewport {
  const [settings, update] = useSettings();
  const [view, setView] = useState<ViewState>(() =>
    normalizeView({ zoom: settings.zoom, cx: settings.cx, cy: settings.cy }),
  );

  const viewRef = useRef(view);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const dragLast = useRef<Pt | null>(null);
  const pinchDist = useRef<number | null>(null);
  // Bounding rect captured at gesture start, reused per move (avoids layout reads).
  const dragRect = useRef<DOMRect | null>(null);
  const tween = useRef<number | null>(null); // rAF id of an in-flight reveal animation
  const [isDragging, setIsDragging] = useState(false);
  // Kept in a ref so callbacks stay stable; fired on any direct user manipulation.
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

  const schedulePersist = useCallback(
    (v: ViewState) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        update({ zoom: v.zoom, cx: v.cx, cy: v.cy });
      }, PERSIST_DELAY);
    },
    [update],
  );

  // Move the viewport imperatively — a DOM attribute write, no React render. Used on
  // every pan/pinch pointermove so dragging never reconciles the (heavy, unmemoized)
  // SVG layer tree. `viewRef` is the live source of truth between renders.
  const applyDom = useCallback(
    (next: ViewState) => {
      viewRef.current = next;
      svgRef.current?.setAttribute("viewBox", viewBoxString(next));
      schedulePersist(next);
    },
    [svgRef, schedulePersist],
  );

  // Commit to React state too — for discrete ops (wheel, buttons) and at gesture end,
  // where a single render is fine and keeps `zoom` (button state) in sync.
  const apply = useCallback(
    (next: ViewState) => {
      applyDom(next);
      setView(next);
    },
    [applyDom],
  );

  const cancelTween = useCallback(() => {
    if (tween.current != null) {
      cancelAnimationFrame(tween.current);
      tween.current = null;
    }
  }, []);

  // Animate the view to `target` (used by reveals). Writes the viewBox imperatively
  // each frame via `applyDom` (no React render), committing state once at the end.
  // Geometric-lerp the zoom (so it feels linear in scale), linear-lerp the centre.
  const animateTo = useCallback(
    (target: ViewState, ms = 380) => {
      cancelTween();
      const to = normalizeView(target);
      const from = viewRef.current;
      const noRaf =
        typeof requestAnimationFrame !== "function" || typeof performance === "undefined";
      const trivial =
        Math.abs(from.zoom - to.zoom) < 1e-3 &&
        Math.abs(from.cx - to.cx) < 1e-4 &&
        Math.abs(from.cy - to.cy) < 1e-4;
      if (noRaf || trivial) {
        apply(to);
        return;
      }
      const start = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic
      const step = (nowT: number) => {
        const t = Math.min(1, (nowT - start) / ms);
        const k = ease(t);
        applyDom(
          normalizeView({
            zoom: from.zoom * Math.pow(to.zoom / from.zoom, k),
            cx: from.cx + (to.cx - from.cx) * k,
            cy: from.cy + (to.cy - from.cy) * k,
          }),
        );
        if (t < 1) {
          tween.current = requestAnimationFrame(step);
        } else {
          tween.current = null;
          setView(to); // commit final state (keeps `zoom` in sync)
        }
      };
      tween.current = requestAnimationFrame(step);
    },
    [apply, applyDom, cancelTween],
  );

  // Keep the DOM viewBox pinned to the live ref after every render, so a stray
  // re-render mid-gesture (e.g. a traffic poll) can't snap the view back to the stale
  // state value before the next paint.
  useLayoutEffect(() => {
    svgRef.current?.setAttribute("viewBox", viewBoxString(viewRef.current));
  });

  // Clear any pending persist / animation on unmount so nothing fires after teardown.
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (tween.current != null) cancelAnimationFrame(tween.current);
    },
    [],
  );

  // Native, non-passive wheel listener so we can preventDefault (page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelTween();
      onInteractRef.current?.();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      apply(zoomAtPoint(viewRef.current, factor, fx, fy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, apply, cancelTween]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = svgRef.current;
    cancelTween(); // grabbing the map interrupts any reveal animation
    onInteractRef.current?.();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragRect.current = el?.getBoundingClientRect() ?? null; // reused for the whole gesture
    try {
      el?.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer no longer active */
    }
    if (pointers.current.size === 1) {
      dragLast.current = { x: e.clientX, y: e.clientY };
      setIsDragging(true);
    } else if (pointers.current.size === 2) {
      // Entering a pinch — stop single-finger panning.
      dragLast.current = null;
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(b.x - a.x, b.y - a.y);
    }
  }, [svgRef, cancelTween]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = svgRef.current;
      if (!el || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = dragRect.current ?? el.getBoundingClientRect();

      // Pan/pinch go through `applyDom` (imperative viewBox write, no re-render), so
      // dragging never reconciles the map's SVG layer tree — the source of the lag.
      if (pointers.current.size >= 2 && pinchDist.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const factor = dist / pinchDist.current;
        pinchDist.current = dist; // incremental baseline
        if (Number.isFinite(factor) && factor > 0) {
          const fx = (midX - rect.left) / rect.width;
          const fy = (midY - rect.top) / rect.height;
          applyDom(zoomAtPoint(viewRef.current, factor, fx, fy));
        }
        return;
      }

      if (dragLast.current) {
        const dxFrac = -(e.clientX - dragLast.current.x) / rect.width;
        const dyFrac = -(e.clientY - dragLast.current.y) / rect.height;
        dragLast.current = { x: e.clientX, y: e.clientY };
        applyDom(panBy(viewRef.current, dxFrac, dyFrac));
      }
    },
    [svgRef, applyDom],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* pointer no longer active */
    }
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 0) {
      dragLast.current = null;
      dragRect.current = null;
      setIsDragging(false);
      // Sync React state to the final imperative position (updates `zoom`, etc.).
      setView(viewRef.current);
    } else {
      // Resume single-finger panning from the remaining pointer.
      const rem = [...pointers.current.values()][0];
      dragLast.current = { x: rem.x, y: rem.y };
    }
  }, []);

  // Manual zoom controls stay instant (snappy); only automatic reveals animate.
  const zoomIn = useCallback(() => {
    cancelTween();
    onInteractRef.current?.();
    apply(zoomAtPoint(viewRef.current, BUTTON_STEP, 0.5, 0.5));
  }, [apply, cancelTween]);
  const zoomOut = useCallback(() => {
    cancelTween();
    onInteractRef.current?.();
    apply(zoomAtPoint(viewRef.current, 1 / BUTTON_STEP, 0.5, 0.5));
  }, [apply, cancelTween]);
  const reset = useCallback(() => {
    cancelTween();
    onInteractRef.current?.();
    apply(normalizeView({ zoom: 1, cx: 0.5, cy: 0.5 }));
  }, [apply, cancelTween]);

  // A reveal frames the target (+ optional context, e.g. the field), adapting the
  // zoom in or out toward a comfortable level and animating there.
  const focusOn = useCallback(
    (target: Pt, context?: Pt) => {
      const pts = context ? [target, context] : [target];
      animateTo(fitPoints(pts, REVEAL_MAX_ZOOM));
    },
    [animateTo],
  );
  const centerOn = useCallback(
    (target: Pt) => animateTo(fitPoints([target], REVEAL_MAX_ZOOM)),
    [animateTo],
  );
  // Tighter reveal framing puts the target near the box edge (it's a bounding
  // extreme), so use a small inset here — only re-reveal when it's genuinely
  // slipping off, not the instant it nears the edge (avoids drift churn).
  const isTargetVisible = useCallback(
    (target: Pt) => isPointVisible(viewRef.current, target, 0.03),
    [],
  );

  return {
    viewBox: viewBoxString(view),
    zoom: view.zoom,
    zoomIn,
    zoomOut,
    reset,
    focusOn,
    centerOn,
    isTargetVisible,
    isDragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}
