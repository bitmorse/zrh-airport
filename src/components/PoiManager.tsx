import { useState } from "react";
import { ZRH_ARP } from "../domain/runways";
import { usePois } from "../hooks/usePois";

const QUICK_EMOJI = ["📍", "⭐", "🎯", "✈️", "🏠", "📷", "⚠️", "🚗", "🅿️", "❤️"];

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100 outline-none focus:border-sky-500";

/**
 * Add / list / remove regions of interest. Each ROI is a lat/lon plus an emoji
 * icon, stored in localStorage and rendered on the map by <PoiLayer>.
 */
export function PoiManager() {
  const { pois, add, remove } = usePois();
  const [emoji, setEmoji] = useState("📍");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (!emoji.trim()) return setError("Pick an emoji.");
    if (!lat || !Number.isFinite(la) || la < -90 || la > 90)
      return setError("Latitude must be a number between -90 and 90.");
    if (!lon || !Number.isFinite(lo) || lo < -180 || lo > 180)
      return setError("Longitude must be a number between -180 and 180.");
    add({ emoji: emoji.trim(), lat: la, lon: lo, label: label.trim() });
    setLat("");
    setLon("");
    setLabel("");
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Regions of interest</h2>
        <p className="text-[11px] text-slate-500">pin a lat/lon with an emoji</p>
      </div>

      {pois.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pois.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md bg-slate-800/40 px-2 py-1 text-xs"
            >
              <span className="text-base leading-none">{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {p.label || <span className="text-slate-500">unnamed</span>}
                <span className="ml-1 text-slate-500">
                  {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.label || "region"}`}
                className="shrink-0 rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {QUICK_EMOJI.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => setEmoji(e)}
              aria-label={`Use ${e}`}
              className={`h-7 w-7 rounded text-base leading-none ${
                emoji === e ? "bg-sky-600/40 ring-1 ring-sky-400" : "hover:bg-slate-800"
              }`}
            >
              {e}
            </button>
          ))}
          <input
            value={emoji}
            onChange={(ev) => setEmoji(ev.target.value)}
            aria-label="Custom emoji"
            maxLength={4}
            className="h-7 w-10 rounded border border-slate-700 bg-slate-800 text-center text-base outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex gap-2">
          <input
            value={lat}
            onChange={(ev) => setLat(ev.target.value)}
            inputMode="decimal"
            placeholder={`lat (${ZRH_ARP.lat})`}
            aria-label="Latitude"
            className={inputCls}
          />
          <input
            value={lon}
            onChange={(ev) => setLon(ev.target.value)}
            inputMode="decimal"
            placeholder={`lon (${ZRH_ARP.lon})`}
            aria-label="Longitude"
            className={inputCls}
          />
        </div>

        <input
          value={label}
          onChange={(ev) => setLabel(ev.target.value)}
          placeholder="label (optional)"
          aria-label="Label"
          maxLength={24}
          className={inputCls}
        />

        {error && <div className="text-[11px] text-red-400">{error}</div>}

        <button
          type="submit"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Add region
        </button>
      </form>
    </div>
  );
}
