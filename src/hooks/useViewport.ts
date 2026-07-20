import { useCallback, useEffect, useRef, useState } from "react";
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
  viewRef.current = view;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const dragLast = useRef<Pt | null>(null);
  const pinchDist = useRef<number | null>(null);
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

  const apply = useCallback(
    (next: ViewState) => {
      setView(next);
      schedulePersist(next);
    },
    [schedulePersist],
  );

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
      const rect = el.getBoundingClientRect();

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
          apply(zoomAtPoint(viewRef.current, factor, fx, fy));
        }
        return;
      }

      if (dragLast.current) {
        const dxFrac = -(e.clientX - dragLast.current.x) / rect.width;
        const dyFrac = -(e.clientY - dragLast.current.y) / rect.height;
        dragLast.current = { x: e.clientX, y: e.clientY };
        apply(panBy(viewRef.current, dxFrac, dyFrac));
      }
    },
    [svgRef, apply],
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
      setIsDragging(false);
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

  return {
    viewBox: viewBoxString(view),
    zoom: view.zoom,
    zoomIn,
    zoomOut,
    reset,
    focusOn,
    isDragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}
