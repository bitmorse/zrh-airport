import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "./icons";

/**
 * Header search: a magnifier button that opens a small input for a flight number
 * ("AI 136"), registration ("HB-JCA") or hex. Submitting hands the raw query up to
 * enter global follow mode.
 */
export function FlightSearch({ onSubmit }: { onSubmit: (query: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    onSubmit(q);
    setOpen(false);
    setValue("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Search for a flight"
        aria-expanded={open}
        title="Search a flight number, registration or hex"
        className={`border p-1.5 ${
          open
            ? "border-primary bg-primary text-on-primary"
            : "border-border text-on-surface-variant hover:bg-surface-container"
        }`}
      >
        <SearchIcon size={18} />
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className="absolute right-0 top-full z-30 mt-1 flex items-center gap-1 border border-border bg-surface-container-lowest p-2 shadow-lg"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Flight no. · reg · hex"
            aria-label="Flight number, registration or hex"
            className="w-40 border border-border bg-surface-container-lowest px-2 py-1 text-xs text-on-surface outline-none focus:border-2 focus:border-primary"
          />
          <button
            type="submit"
            className="shrink-0 border border-border px-2 py-1 text-xs uppercase text-on-surface-variant hover:bg-surface-container"
          >
            Track
          </button>
        </form>
      )}
    </div>
  );
}
