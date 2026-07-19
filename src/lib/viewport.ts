import { SVG_W, SVG_H } from "./projection";

/**
 * Zoom / pan maths for the SVG map. State is `{ zoom, cx, cy }` where zoom is the
 * scale factor (1 = full extent) and cx/cy are the normalized view centre in
 * [0,1]. Everything is derived into an SVG `viewBox`, so the render stays crisp.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface ViewState {
  zoom: number;
  cx: number;
  cy: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Clamp the centre so the visible box never leaves the world. At zoom 1 the box
 * fills the world, so the centre is pinned to 0.5.
 */
export function clampCenter(zoom: number, c: number): number {
  const half = 1 / (2 * zoom); // half the visible fraction of the world
  return Math.max(half, Math.min(1 - half, clamp01(c)));
}

export function normalizeView(v: ViewState): ViewState {
  const zoom = clampZoom(v.zoom);
  return { zoom, cx: clampCenter(zoom, v.cx), cy: clampCenter(zoom, v.cy) };
}

export function computeViewBox(v: ViewState): ViewBox {
  const { zoom, cx, cy } = normalizeView(v);
  const w = SVG_W / zoom;
  const h = SVG_H / zoom;
  return { x: cx * SVG_W - w / 2, y: cy * SVG_H - h / 2, w, h };
}

export function viewBoxString(v: ViewState): string {
  const b = computeViewBox(v);
  return `${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}`;
}

/**
 * Zoom by `factor` about a focus point given as fractions (fx,fy) of the current
 * *viewport* (0,0 = top-left, 1,1 = bottom-right). Keeps that world point under
 * the cursor after zooming.
 */
export function zoomAtPoint(
  v: ViewState,
  factor: number,
  fx: number,
  fy: number,
): ViewState {
  const cur = normalizeView(v);
  const nextZoom = clampZoom(cur.zoom * factor);
  if (nextZoom === cur.zoom) return cur;

  const box = computeViewBox(cur);
  // World coordinate (as a fraction of the whole world) under the focus point.
  const worldFx = (box.x + fx * box.w) / SVG_W;
  const worldFy = (box.y + fy * box.h) / SVG_H;
  // New half-extents (as world fractions) at the new zoom.
  const halfW = 1 / (2 * nextZoom);
  const halfH = 1 / (2 * nextZoom);
  // Solve for centre so the focus point stays at the same viewport fraction.
  const cx = worldFx + (0.5 - fx) * (2 * halfW);
  const cy = worldFy + (0.5 - fy) * (2 * halfH);
  return normalizeView({ zoom: nextZoom, cx, cy });
}

/** Pan by a fraction of the current viewport (e.g. from a drag delta). */
export function panBy(v: ViewState, dxFrac: number, dyFrac: number): ViewState {
  const cur = normalizeView(v);
  const visW = 1 / cur.zoom;
  const visH = 1 / cur.zoom;
  return normalizeView({
    zoom: cur.zoom,
    cx: cur.cx + dxFrac * visW,
    cy: cur.cy + dyFrac * visH,
  });
}
