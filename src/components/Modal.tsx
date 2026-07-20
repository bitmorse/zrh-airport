import { useEffect } from "react";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[90dvh] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
