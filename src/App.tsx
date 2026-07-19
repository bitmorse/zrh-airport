import { useMemo, useState } from "react";
import { AirportSvg } from "./components/AirportSvg";
import { Legend } from "./components/Legend";
import { SettingsModal } from "./components/SettingsModal";
import { useLiveTraffic } from "./hooks/useLiveTraffic";
import { useNow } from "./hooks/useNow";
import { useSettings } from "./hooks/useSettings";

export default function App() {
  const [settings] = useSettings();
  const traffic = useLiveTraffic(settings);
  const [showSettings, setShowSettings] = useState(false);
  const now = useNow(1000);

  const ageSec =
    traffic.lastUpdated != null
      ? Math.max(0, Math.round((now - traffic.lastUpdated) / 1000))
      : null;

  const activeCount = useMemo(
    () => traffic.aircraft.filter((a) => a.assignment).length,
    [traffic.aircraft],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">
            ZRH Runway Traffic
          </h1>
          <p className="text-xs text-slate-400">
            Zürich Airport (LSZH) · last 15 min · inferred from open ADS-B
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          aria-label="Open settings"
        >
          ⚙︎ Settings
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="relative min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <AirportSvg aircraft={traffic.aircraft} counts={traffic.counts} />
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-72">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <StatusBar
              ageSec={ageSec}
              provider={traffic.provider}
              activeCount={activeCount}
              total={traffic.aircraft.length}
              isFetching={traffic.isFetching}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <Legend />
          </div>

          {traffic.isError && !traffic.lastUpdated && (
            <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              Couldn’t reach any ADS-B provider. Retrying…
              <div className="mt-1 text-xs text-red-300/70">
                {traffic.error?.message}
              </div>
            </div>
          )}

          <p className="px-1 text-[11px] leading-relaxed text-slate-500">
            Runway use is inferred from aircraft position, track and altitude —
            not an official airport feed. Data:{" "}
            <span className="text-slate-400">adsb.lol / adsb.fi / airplanes.live</span>.
            Everything runs in your browser; nothing is sent to a server.
          </p>
        </aside>
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function StatusBar({
  ageSec,
  provider,
  activeCount,
  total,
  isFetching,
}: {
  ageSec: number | null;
  provider: string | null;
  activeCount: number;
  total: number;
  isFetching: boolean;
}) {
  const stale = ageSec != null && ageSec > 120;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Row label="Updated">
        {ageSec == null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className={stale ? "text-amber-400" : "text-slate-200"}>
            {ageSec}s ago{isFetching ? " · refreshing" : ""}
          </span>
        )}
      </Row>
      <Row label="Source">
        <span className="text-slate-200">{provider ?? "—"}</span>
      </Row>
      <Row label="Near field">
        <span className="text-slate-200">
          {activeCount} on runways · {total} tracked
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      {children}
    </div>
  );
}
