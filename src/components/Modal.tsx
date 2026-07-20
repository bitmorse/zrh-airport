import { useEffect } from "react";
import { CloseIcon } from "./icons";

/**
 * Shared modal shell: a dimmed backdrop that closes on click/Escape, a centred panel
 * that swallows clicks, and a title bar with a close button. Extracted so Settings,
 * the recorder and the stats modal all share one accessible dialog.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-md",
  headerRight,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  maxWidth?: string;
  /** Optional controls rendered on the right of the title bar. */
  headerRight?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Active overlay: high-contrast 2px border + dimming backdrop, no shadow. */}
      <div
        className={`flex max-h-[90dvh] w-full ${maxWidth} flex-col overflow-hidden border-2 border-border bg-surface-container-lowest`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold uppercase tracking-wide text-on-surface">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              aria-label="Close"
              className="px-2 py-0.5 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
