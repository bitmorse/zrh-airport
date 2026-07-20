import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fitPoints,
  isPointVisible,
  normalizeView,
  panBy,
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
  /** Reveal `target` if it's off-screen, framing it with `context` (e.g. the field). */
  focusOn: (target: Pt, context?: Pt) => void;
  /** Recenter on `target` at the current zoom, even if it's already visible. */
  centerOn: (target: Pt) => void;
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
export function useViewport(svgRef: React.RefObject<SVGSVGElement | null>): Viewport {
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
  const [isDragging, setIsDragging] = useState(false);

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

  // Commit to React state too — for discrete ops (wheel, buttons, focus/center) and at
  // gesture end, where a single render is fine and keeps `zoom` (button state) in sync.
  const apply = useCallback(
    (next: ViewState) => {
      applyDom(next);
      setView(next);
    },
    [applyDom],
  );

  // Keep the DOM viewBox pinned to the live ref after every render, so a stray
  // re-render mid-gesture (e.g. a traffic poll) can't snap the view back to the stale
  // state value before the next paint.
  useLayoutEffect(() => {
    svgRef.current?.setAttribute("viewBox", viewBoxString(viewRef.current));
  });

  // Clear any pending persist on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
  );

  // Native, non-passive wheel listener so we can preventDefault (page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      apply(zoomAtPoint(viewRef.current, factor, fx, fy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, apply]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = svgRef.current;
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
  }, [svgRef]);

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

  const zoomIn = useCallback(
    () => apply(zoomAtPoint(viewRef.current, BUTTON_STEP, 0.5, 0.5)),
    [apply],
  );
  const zoomOut = useCallback(
    () => apply(zoomAtPoint(viewRef.current, 1 / BUTTON_STEP, 0.5, 0.5)),
    [apply],
  );
  const reset = useCallback(
    () => apply(normalizeView({ zoom: 1, cx: 0.5, cy: 0.5 })),
    [apply],
  );
  const focusOn = useCallback(
    (target: Pt, context?: Pt) => {
      // Only adjust the view when the target isn't already comfortably on screen.
      if (isPointVisible(viewRef.current, target)) return;
      const pts = context ? [target, context] : [target];
      apply(fitPoints(pts, viewRef.current.zoom));
    },
    [apply],
  );
  const centerOn = useCallback(
    (target: Pt) => apply(fitPoints([target], viewRef.current.zoom)),
    [apply],
  );

  return {
    viewBox: viewBoxString(view),
    zoom: view.zoom,
    zoomIn,
    zoomOut,
    reset,
    focusOn,
    centerOn,
    isDragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}
