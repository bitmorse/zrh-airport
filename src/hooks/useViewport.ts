import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  isDragging: boolean;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

/**
 * Zoom/pan controller for the map SVG. State is seeded from persisted settings
 * and written back (throttled) so the zoom level and pan survive reloads.
 * `svgRef` is needed to map screen coordinates into the viewport.
 */
export function useViewport(svgRef: React.RefObject<SVGSVGElement | null>): Viewport {
  const [settings, update] = useSettings();
  const [view, setView] = useState<ViewState>(() =>
    normalizeView({ zoom: settings.zoom, cx: settings.cx, cy: settings.cy }),
  );

  const viewRef = useRef(view);
  viewRef.current = view;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
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
    drag.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const dxFrac = -(e.clientX - drag.current.x) / rect.width;
      const dyFrac = -(e.clientY - drag.current.y) / rect.height;
      drag.current = { x: e.clientX, y: e.clientY };
      apply(panBy(viewRef.current, dxFrac, dyFrac));
    },
    [svgRef, apply],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    setIsDragging(false);
    (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
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

  return {
    viewBox: viewBoxString(view),
    zoom: view.zoom,
    zoomIn,
    zoomOut,
    reset,
    isDragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
