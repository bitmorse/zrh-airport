/**
 * Icon library — sharp, rectilinear SVG glyphs for the whole UI (per DESIGN_1.md:
 * "Data over Decoration", square/triangle status marks, no rounded consumer softness).
 *
 * Every icon inherits its colour from `currentColor` and its size from the font
 * (`1em` by default) — callers tint with a text-token class (e.g. `text-status-arrival`)
 * and never pass inline hex or px. Pass `title` to expose an accessible name; otherwise
 * the glyph is decorative (`aria-hidden`) and the surrounding control carries the label.
 */
import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Font-relative size; defaults to 1em so icons track the text they sit beside. */
  size?: number | string;
  /** Accessible name. When set the icon becomes `role="img"`; otherwise decorative. */
  title?: string;
};

function Svg({
  size = "1em",
  title,
  viewBox,
  children,
  ...rest
}: IconProps & { viewBox: string; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* --- Supplied brand icons ------------------------------------------------- */

/** Departure / takeoff (climbing plane). Replaces 🛫. */
export function TakeoffIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M3 18H21V20H3zM20.5 8A1.5 1.5 0 1 0 20.5 11 1.5 1.5 0 1 0 20.5 8z" />
      <path d="M2 10.87L4.563 15.243 20.882 10.946 20.114 8.049 14.883 9.425 8.082 3.113 6.271 3.66 10.269 10.637 5.176 11.981 3.367 10.46z" />
    </Svg>
  );
}

/** Arrival / landing (descending plane). Replaces 🛬. */
export function LandingIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M3 19H21V21H3zM19.5 13A1.5 1.5 0 1 0 19.5 16 1.5 1.5 0 1 0 19.5 13z" />
      <path d="M14.789 11.691L11.984 2.846 10 2.4 10 10.424 5.084 9.129 4.26 6.913 3 6.626 3 11.68 19.148 15.96 19.908 13.061z" />
    </Svg>
  );
}

/** Airplane silhouette (nose points +x / east at rotation 0). Replaces ✈ and the map glyph. */
export const AIRPLANE_PATH =
  "M8,22h2l4.997-8H20c1.105,0,2-0.895,2-2s-0.895-2-2-2h-5.003L10,2H8l2.493,8H4.996L3.5,8H2l1,4l-1,4h1.5l1.496-2h5.497L8,22z";
export function PlaneIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d={AIRPLANE_PATH} />
    </Svg>
  );
}

/** Crosshair target. Replaces 📍 "use my location" / the ⌖ locate button. */
export function MyLocationIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 50 50" {...p}>
      <path d="M 23 0 L 23 4.0957031 C 13.018702 5.0446992 5.046896 13.018494 4.0976562 23 L 0 23 L 0 27 L 4.0976562 27 C 5.046896 36.981506 13.018702 44.955301 23 45.904297 L 23 50 L 27 50 L 27 45.902344 C 36.981223 44.953131 44.953131 36.981223 45.902344 27 L 50 27 L 50 23 L 45.902344 23 C 44.953131 13.018777 36.981223 5.046869 27 4.0976562 L 27 0 L 23 0 z M 27 8.1269531 C 34.805997 9.0369175 40.963083 15.194003 41.873047 23 L 39 23 L 39 27 L 41.873047 27 C 40.963083 34.805997 34.805997 40.963083 27 41.873047 L 27 39 L 23 39 L 23 41.871094 C 15.196372 40.959902 9.0368425 34.805354 8.1269531 27 L 11 27 L 11 23 L 8.1269531 23 C 9.0368425 15.194646 15.196372 9.0400983 23 8.1289062 L 23 11 L 27 11 L 27 8.1269531 z M 25 18 A 7 7 0 0 0 18 25 A 7 7 0 0 0 25 32 A 7 7 0 0 0 32 25 A 7 7 0 0 0 25 18 z" />
    </Svg>
  );
}

/** Microphone crossed out (recording muted / mic disabled). */
export function MicOffIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 48 48" {...p}>
      <path d="M 24 2 C 19.04 2 15 6.04 15 11 L 15 26 C 15 26.21 15.009531 26.419141 15.019531 26.619141 L 16.5 25.140625 L 16.5 25.138672 L 17.75 23.890625 L 30 11.640625 L 30 11.638672 L 31.449219 10.189453 L 32.75 8.890625 C 31.8 4.940625 28.23 2 24 2 z M 42.470703 3.9863281 A 1.50015 1.50015 0 0 0 41.439453 4.4394531 L 4.4394531 41.439453 A 1.50015 1.50015 0 1 0 6.5605469 43.560547 L 13.466797 36.654297 C 15.840795 39.006844 18.995617 40.563363 22.5 40.914062 L 22.5 45.5 A 1.50015 1.50015 0 1 0 25.5 45.5 L 25.5 40.923828 C 33.068393 40.168472 39 33.76368 39 26 L 39 22.5 C 39 21.67 38.33 21 37.5 21 C 36.67 21 36 21.67 36 22.5 L 36 26 C 36 32.560034 30.71517 37.893986 24.177734 37.990234 A 1.50015 1.50015 0 0 0 24.126953 37.984375 A 1.50015 1.50015 0 0 0 23.976562 37.978516 A 1.50015 1.50015 0 0 0 23.826172 37.988281 A 1.50015 1.50015 0 0 0 23.818359 37.990234 C 23.817703 37.990224 23.817062 37.990244 23.816406 37.990234 C 20.609982 37.941414 17.70768 36.633843 15.585938 34.535156 L 17.712891 32.408203 C 19.337761 34.002776 21.549803 35 24 35 C 28.96 35 33 30.96 33 26 L 33 17.121094 L 43.560547 6.5605469 A 1.50015 1.50015 0 0 0 42.470703 3.9863281 z M 10.5 21 C 9.67 21 9 21.67 9 22.5 L 9 26 C 9 27.97 9.3803125 29.850313 10.070312 31.570312 L 12.439453 29.199219 C 12.149453 28.179219 12 27.11 12 26 L 12 22.5 C 12 21.67 11.33 21 10.5 21 z" />
    </Svg>
  );
}

/** Microphone (recording enabled / mic live). */
export function MicOnIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M 12 2 C 10.343 2 9 3.343 9 5 L 9 11 C 9 12.657 10.343 14 12 14 C 13.657 14 15 12.657 15 11 L 15 5 C 15 3.343 13.657 2 12 2 z M 6.0878906 11 C 5.4818906 11 4.9937969 11.537719 5.0917969 12.136719 C 5.5816755 15.136436 7.9811339 17.488992 11 17.921875 L 11 20 C 11 20.552 11.448 21 12 21 C 12.552 21 13 20.552 13 20 L 13 17.921875 C 16.018866 17.488992 18.418325 15.136436 18.908203 12.136719 C 19.006203 11.537719 18.518109 11 17.912109 11 C 17.418109 11 17.010734 11.363563 16.927734 11.851562 C 16.522734 14.206563 14.471 16 12 16 C 9.529 16 7.4772656 14.206563 7.0722656 11.851562 C 6.9892656 11.363563 6.5828906 11 6.0878906 11 z" />
    </Svg>
  );
}

/** Speaker (cone only). Shared body for the sound on/off marks. */
const SPEAKER_BODY =
  "M 24.1875 3 C 23.277344 3 22.332031 3.4375 21.5625 4.21875 L 9.9375 15.8125 C 9.296875 16.378906 9 17.476563 9 18.25 L 9 31.75 C 9 32.515625 9.316406 33.609375 9.90625 34.125 L 21.5 45.6875 C 22.554688 46.761719 23.527344 47 24.15625 47 C 25.824219 47 27 45.476563 27 43.3125 L 27 6.3125 C 27 4.035156 25.539063 3 24.1875 3 Z M 3 15.96875 C 1.324219 15.96875 -0.03125 17.324219 -0.03125 19 L -0.03125 31 C -0.03125 32.675781 1.324219 34.03125 3 34.03125 L 7.46875 34.03125 C 7.140625 33.246094 7 32.410156 7 31.75 L 7 18.25 C 7 17.59375 7.164063 16.761719 7.5 15.96875 Z";

/** Speaker with an ✕ (audio muted). Replaces 🔇. */
export function SoundOffIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 50 50" {...p}>
      <path d={SPEAKER_BODY} />
      <path d="M 31.90625 18.96875 C 31.863281 18.976563 31.820313 18.988281 31.78125 19 C 31.40625 19.066406 31.105469 19.339844 31 19.703125 C 30.894531 20.070313 31.003906 20.460938 31.28125 20.71875 L 35.5625 25 L 31.28125 29.28125 C 30.882813 29.679688 30.882813 30.320313 31.28125 30.71875 C 31.679688 31.117188 32.320313 31.117188 32.71875 30.71875 L 37 26.4375 L 41.28125 30.71875 C 41.679688 31.117188 42.320313 31.117188 42.71875 30.71875 C 43.117188 30.320313 43.117188 29.679688 42.71875 29.28125 L 38.4375 25 L 42.71875 20.71875 C 43.042969 20.417969 43.128906 19.941406 42.933594 19.546875 C 42.742188 19.148438 42.308594 18.929688 41.875 19 C 41.652344 19.023438 41.441406 19.125 41.28125 19.28125 L 37 23.5625 L 32.71875 19.28125 C 32.511719 19.058594 32.210938 18.945313 31.90625 18.96875 Z" />
    </Svg>
  );
}

/** Speaker with waves (audio on). Replaces 🔊. */
export function SoundOnIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 50 50" {...p}>
      <path d={SPEAKER_BODY} />
      <path
        d="M 33 18 A 10 10 0 0 1 33 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M 38 13 A 17 17 0 0 1 38 37"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Settings gear. Replaces ⚙︎. */
export function SettingsIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
    </Svg>
  );
}

/* --- Drawn action glyphs (one rectilinear icon system) -------------------- */

/** Play (triangle). Replaces ▶. */
export function PlayIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M8 5v14l11-7z" />
    </Svg>
  );
}

/** Stop / filled square. Replaces ■ and doubles as a square status mark. */
export function StopIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M6 6h12v12H6z" />
    </Svg>
  );
}

/** Small filled square status mark (record dot, live/flash indicators). Replaces ● ◉ ◈. */
export function SquareIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M7 7h10v10H7z" />
    </Svg>
  );
}

/** Download (tray + down arrow). Replaces ⭳. */
export function DownloadIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
    </Svg>
  );
}

/** Close (✕). */
export function CloseIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </Svg>
  );
}

/** Refresh (⟳). */
export function RefreshIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </Svg>
  );
}

/** Back arrow (←). */
export function BackIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
    </Svg>
  );
}

/** Disclosure caret (▾). */
export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M7 10l5 5 5-5z" />
    </Svg>
  );
}

/** External link (↗ in a frame). */
export function ExternalLinkIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z" />
    </Svg>
  );
}

/** Zoom in (＋). */
export function ZoomInIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
    </Svg>
  );
}

/** Zoom out (−). */
export function ZoomOutIcon(p: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" {...p}>
      <path d="M19 13H5v-2h14z" />
    </Svg>
  );
}
