import { useState } from "react";
import { useAirport } from "../hooks/useAirport";
import { usePois } from "../hooks/usePois";
import { CloseIcon, MyLocationIcon } from "./icons";

const QUICK_EMOJI = ["📍", "⭐", "🎯", "✈️", "🏠", "📷", "⚠️", "🚗", "🅿️", "❤️"];

const inputCls =
  "w-full border border-border bg-surface-container-lowest px-2 py-1 text-on-surface outline-none focus:border-2 focus:border-primary";

/**
 * Add / list / remove regions of interest. Each ROI is a lat/lon plus an emoji
 * icon, stored in localStorage and rendered on the map by <PoiLayer>.
 */
export function PoiManager() {
  const { pois, add, remove } = usePois();
  const { arp } = useAirport().config;
  const [emoji, setEmoji] = useState("📍");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("Geolocation isn’t available in this browser.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(5));
        setLon(pos.coords.longitude.toFixed(5));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn’t get your location.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-on-surface">Regions of interest</h2>
        <p className="text-[11px] text-muted">pin a lat/lon with an emoji</p>
      </div>

      {pois.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pois.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 bg-surface-container px-2 py-1 text-xs"
            >
              <span className="text-base leading-none">{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-on-surface-variant">
                {p.label || <span className="text-muted">unnamed</span>}
                <span className="ml-1 text-muted">
                  {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.label || "region"}`}
                className="shrink-0 px-1 text-muted hover:bg-surface-container-high hover:text-on-surface"
              >
                <CloseIcon size={13} />
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
              className={`h-7 w-7 text-base leading-none ${
                emoji === e ? "bg-primary ring-1 ring-primary" : "hover:bg-surface-container"
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
            className="h-7 w-10 border border-border bg-surface-container-lowest text-center text-base outline-none focus:border-2 focus:border-primary"
          />
        </div>

        <div className="flex gap-2">
          <input
            value={lat}
            onChange={(ev) => setLat(ev.target.value)}
            inputMode="decimal"
            placeholder={`lat (${arp.lat})`}
            aria-label="Latitude"
            className={inputCls}
          />
          <input
            value={lon}
            onChange={(ev) => setLon(ev.target.value)}
            inputMode="decimal"
            placeholder={`lon (${arp.lon})`}
            aria-label="Longitude"
            className={inputCls}
          />
        </div>

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center justify-center gap-1.5 border border-border bg-surface-container px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
        >
          {locating ? (
            "Locating…"
          ) : (
            <>
              <MyLocationIcon size={13} /> Use my location
            </>
          )}
        </button>

        <input
          value={label}
          onChange={(ev) => setLabel(ev.target.value)}
          placeholder="label (optional)"
          aria-label="Label"
          maxLength={24}
          className={inputCls}
        />

        {error && <div className="text-[11px] text-status-alert">{error}</div>}

        <button
          type="submit"
          className="border border-primary bg-primary px-3 py-1.5 text-sm font-medium uppercase text-on-primary hover:bg-primary-container"
        >
          Add region
        </button>
      </form>
    </div>
  );
}
