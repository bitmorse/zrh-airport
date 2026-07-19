import { useEffect, useState } from "react";
import { PROVIDER_NAMES } from "../data/adsb";
import { DEFAULT_SETTINGS, useSettings } from "../hooks/useSettings";

/**
 * Settings dialog. All values are persisted to localStorage. The default data
 * source needs no credentials; the API-token field exists so a key can be
 * requested and stored locally if a provider ever requires one — no backend.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, update] = useSettings();
  const [pollSeconds, setPollSeconds] = useState(String(settings.pollSeconds));
  const [radiusNm, setRadiusNm] = useState(String(settings.radiusNm));
  const [provider, setProvider] = useState(settings.provider ?? "");
  const [apiToken, setApiToken] = useState(settings.apiToken ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    update({
      pollSeconds: clamp(Number(pollSeconds) || DEFAULT_SETTINGS.pollSeconds, 15, 600),
      radiusNm: clamp(Number(radiusNm) || DEFAULT_SETTINGS.radiusNm, 5, 250),
      provider: provider || null,
      apiToken: apiToken.trim() || null,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Settings</h2>

        <div className="flex flex-col gap-4 text-sm">
          <Field label="Refresh interval (seconds)" hint="15–600">
            <input
              type="number"
              min={15}
              max={600}
              value={pollSeconds}
              onChange={(e) => setPollSeconds(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Query radius (nautical miles)" hint="5–250">
            <input
              type="number"
              min={5}
              max={250}
              value={radiusNm}
              onChange={(e) => setRadiusNm(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Preferred data provider" hint="tried first; others are fallbacks">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className={inputCls}
            >
              <option value="">Auto (adsb.lol → fallbacks)</option>
              {PROVIDER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="API token (optional)"
            hint="stored only in your browser; not needed for the default source"
          >
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="none required"
              className={inputCls}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100 outline-none focus:border-sky-500";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}
