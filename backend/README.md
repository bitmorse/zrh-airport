# zrh-airport stats backend

A tiny PHP + SQLite service that collects airport movement statistics (landings
and takeoffs per runway) **around the clock**, independent of whether any user
has the web app open. It runs as a cron job on NearlyFreeSpeech.NET shared
hosting and exposes a read-only REST API for the app's Stats card.

## Why a backend at all

The frontend only accumulates stats while a browser tab is open. This collector
polls ADS-B on a schedule from the server, detects landings/takeoffs, and stores
compact aggregates so the history survives and is shared across all users.

## Architecture

```
NFS Scheduled Task (every 10 min, self-loops @30s)   SQLite (backend/data/stats.db)
  php bin/collect.php --loop 540 --every 30 LSZH   movements  — one row per event,
    ├─ Store::loadTracker()   ← detector state                pre-bucketed to local hour
    ├─ Adsb::fetchAircraftNear()  (adsb.lol → .fi → .live)  tracker    — per-aircraft memory
    ├─ Detector::detect()     → landings/takeoffs             between cron runs
    ├─ Store::insertMovements()
    ├─ Store::saveTracker()
    └─ Store::pruneMovements()  (>60 days)
                                                 Read API (public/index.php)
Browser Stats card ── GET /api/v1/LSZH/movements ──▶ Zrh\Api::handle → JSON
                      GET /api/v1/LSZH/summary
```

- **Stateless cron, stateful detection.** Each run is a fresh process, but
  landing/takeoff detection needs the previous poll. That memory lives in the
  `tracker` table (`Store::loadTracker`/`saveTracker`), not in process RAM.
- **Detection is a reduced port** of the frontend's `src/domain` logic — just the
  two countable events. Threshold constants in `src/Detector.php` mirror
  `src/domain/departures.ts`; **keep them in sync when tuning either side.**
- **Read-only public API.** The collector is the only writer and runs locally on
  the same box, so there is no ingest endpoint and no authentication anywhere.

## Layout

```
backend/
  src/          Geo, Airport, Adsb, Detector, Store, Collector, Api  (namespace Zrh\)
  config/       airports.json (ported from src/data/airports.ts), app.php
  bin/          collect.php   — cron entry point
  airports-api/ index.php + .htaccess  — web-facing API front controller
  data/         stats.db at runtime (gitignored; keep OUTSIDE the docroot on NFS)
  tests/        zero-dependency test runner + suites
```

## Running the tests

No Composer/PHPUnit needed — a bare interpreter runs the suite:

```
php backend/tests/run.php
```

Written red-green; every module (Geo, Airport, Detector, Adsb, Store, Collector,
Api) has a suite.

## Running the collector locally

```
php backend/bin/collect.php LSZH                       # one poll; prints a summary line
php backend/bin/collect.php --loop 540 --every 30 LSZH # poll every 30s for 9 min
php backend/bin/collect.php --loop 540 --every 30 --all # every configured airport
php backend/bin/collect.php LSZH VTBS                   # sweep specific airports
ZRH_DB=/tmp/stats.db php backend/bin/collect.php LSZH
```

Movements only appear when aircraft actually land/take off during a poll, so run
the looping form for a while, then query the API (below).

### Why the loop

NFS scheduled tasks fire at most about **once every 10 minutes** — far too coarse
for movement detection (a landing sits on the runway for ~90s, so a 10-min poll
would miss most of them). `--loop N --every M` makes one cron kick poll every `M`
seconds for `N` seconds and then exit, so a 10-minute cron gives continuous 30s
cadence 24/7. Keep `N` a little under the cron period (e.g. `--loop 540` for a
10-min task) so runs don't overlap; a flock skips a kick if the previous run is
somehow still going. The process is mostly asleep between polls (low CPU/RAU) and
is safe to be killed mid-run — each poll commits independently and the next kick
resumes.

## REST API

Mounted at `bitmorse.com/airports-api`. Routes are matched by their trailing
segments, so the same code works under any base path.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/airports-api/health` | liveness |
| GET | `/airports-api/{icao}/movements?days=60` | per-runway-end 24h histogram |
| GET | `/airports-api/{icao}/summary?days=60` | totals, distinct days, busiest hour |

`{icao}` is case-insensitive and must be a configured airport (`LSZH`, `VTBS`).
`days` is clamped to the 60-day retention window. Responses are gzip-friendly
JSON with `Cache-Control: public, max-age=300` and a data-based `ETag`, so a
reopened card revalidates to a cheap `304`. Fetch **on open, not on a poll.**

The `movements` payload mirrors the frontend's `RunwayHistogram` shape
(`src/domain/movementStats.ts`): `ends[]` busiest-first, each with 24 `hours`.

## Deploying on NearlyFreeSpeech

This backend is served as a subfolder of the existing `bitmorse.com` site, at
`bitmorse.com/airports-api`. Recommended layout keeps the code and DB out of the
web docroot and exposes only the front controller:

1. **Upload** the whole `backend/` folder somewhere non-public, e.g.
   `/home/protected/backend`.
2. **Mount the front controller.** In the existing docroot (`/home/public`),
   the `airports-api/` folder holds `index.php` + `.htaccess`. Point it at the
   code by adding one line to `airports-api/.htaccess`:
   ```
   SetEnv ZRH_BACKEND_ROOT /home/protected/backend
   ```
   (`index.php` also auto-discovers the backend root by walking up from itself,
   which is enough if `airports-api/` sits *inside* `backend/`; the `SetEnv` is
   needed only for the split layout where the code lives elsewhere.)
   Keep `RewriteBase /airports-api/` in that `.htaccess` matching the URL path.
3. **Database outside the docroot.** Add to the same `.htaccess`:
   ```
   SetEnv ZRH_DB /home/protected/backend/data/stats.db
   ```
   The DB and its `-wal`/`-shm` sidecars must never be web-served. If `src/`,
   `config/` or `data/` do end up under the docroot, deny them (`data/.htaccess`
   already does this).
4. **Scheduled Task** (Site → *Manage Scheduled Tasks*):
   - Command (all configured airports): `php /home/protected/backend/bin/collect.php --loop 540 --every 30 --all`
     (or name specific airports instead of `--all`, e.g. `... --every 30 LSZH`).
   - Tag: `collect`, run at the panel's **maximum frequency** (NFS caps this at
     ~every 10 minutes). The `--loop` makes each kick poll every 30s for 9 minutes,
     so you get continuous cadence despite the coarse cron. No `ZRH_DB` needed in
     the command — the default path matches the API's.
   - If NFS kills long-running tasks, lower `--loop` (e.g. `--loop 240`); it's safe.
   - Verify a run finished by opening `/airports-api/health` — `polls10m` should
     be ~18–20 after a full loop.
5. **Dead-man's switch (optional).** Set `ZRH_HEALTHCHECK_URL` to a
   healthchecks.io ping URL in the task command; the collector pings it after a
   successful sweep so you're alerted if collection silently stops.

Then check `https://bitmorse.com/airports-api/health` returns `{"ok":true}`.

## Bandwidth & storage

- Collector fetches ~15–20 KB per poll → ~50–60 MB/day at 30s cadence. Well under
  the 1 GB/day limit.
- The read API is fetched on card-open (not polled) and cached, so 100 users add
  negligible traffic.
- Storage: aggregates only. ~60 days of movements is a few MB; `tracker` is
  bounded by the count of currently-airborne aircraft.

## Limitations (v1)

- 30s loop cadence can miss a fast touch-and-go; fine for aggregate counts.
- Detection is a reduced heuristic, independent of the frontend's — the two can
  drift slightly. No clearance-wait / airline / destination stats yet (the schema
  keeps `hex` per movement so those can be added without a migration).
