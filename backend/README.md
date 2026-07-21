# zrh-airport stats backend

A tiny PHP + SQLite service that collects airport movement statistics (landings
and takeoffs per runway) **around the clock**, independent of whether any user
has the web app open. It runs as a persistent daemon on NearlyFreeSpeech.NET
shared hosting and exposes a read-only REST API for the app's Stats card.

## Why a backend at all

The frontend only accumulates stats while a browser tab is open. This collector
polls ADS-B on a schedule from the server, detects landings/takeoffs, and stores
compact aggregates so the history survives and is shared across all users.

## Architecture

```
NFS Daemon (polls every 30s, 24/7)                  SQLite (backend/data/stats.db)
  php bin/collect.php --forever --every 30 --all      movements — one row per event,
    ├─ Store::loadTracker()   ← detector state                    pre-bucketed to local hour
    ├─ Adsb::fetchAircraftNear() (adsb.lol → .fi → .live)  tracker  — per-aircraft memory
    ├─ Detector::detect()     → landings/takeoffs                  across polls
    ├─ Store::insertMovements()                          poll_log  — heartbeats (for /health)
    ├─ Store::saveTracker()  ├─ Store::recordPoll()      weather   — hourly, upserted
    ├─ Store::pruneMovements() (>60 days)                          (Open-Meteo, every ~15 min)
    └─ Weather::fetchHourly() → Store::upsertWeather() (throttled, >365 days pruned)
                                                     Read API (airports-api/index.php)
Browser Stats card ── GET /airports-api/LSZH/movements ──▶ Zrh\Api::handle → JSON
                      GET /airports-api/LSZH/summary       (read-only, Store::openReader)
                      GET /airports-api/LSZH/weather
```

- **Persistent process, persisted state.** Landing/takeoff detection needs the
  previous poll. That memory lives in the `tracker` table
  (`Store::loadTracker`/`saveTracker`), so the process can be restarted anytime
  without losing continuity.
- **Detection is a reduced port** of the frontend's `src/domain` logic — just the
  two countable events. Threshold constants in `src/Detector.php` mirror
  `src/domain/departures.ts`; **keep them in sync when tuning either side.**
- **Read-only API.** The daemon is the only writer; the API opens the DB
  read-only (`Store::openReader`), so it needs no write access and there's no
  ingest endpoint and no authentication anywhere.
- **Rollback-journal, not WAL.** On NFS the API runs as a different, lower-priv
  user than the daemon; WAL would require that reader to write sidecar files it
  can't. Plain DELETE-journal mode lets a read-only reader work with only file
  read permission.

## Layout

```
backend/
  src/          Geo, Airport, Adsb, Weather, Detector, Store, Collector, Api, Cli  (namespace Zrh\)
  config/       airports.json (ported from src/data/airports.ts), app.php
  bin/          collect.php — collector entry; daemon.sh — NFS daemon run script
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
php backend/bin/collect.php LSZH                        # one poll; prints a summary line
php backend/bin/collect.php --forever --every 30 --all  # daemon: poll forever, all airports
php backend/bin/collect.php --loop 540 --every 30 LSZH  # bounded loop (9 min)
php backend/bin/collect.php LSZH VTBS                    # sweep specific airports
ZRH_DB=/tmp/stats.db php backend/bin/collect.php LSZH
```

Movements only appear when aircraft actually land/take off during a poll, so run
the looping form for a while, then query the API (below).

### Why a daemon (not a scheduled task)

Movement detection needs frequent polling — a landing sits on the runway for only
~90s. But NFS scheduled tasks fire at most ~every 10 min **and** are time-limited
(~3 min per run), so they can't poll continuously; they'd leave multi-minute blind
gaps. So the collector runs as an NFS **Daemon** with `--forever`, polling every
30s around the clock. It's mostly asleep between polls (low CPU/RAU), a flock keeps
a single instance, and each poll commits independently so a restart loses nothing.

`--loop N --every M` (bounded loop, exits after `N` seconds) still exists for the
scheduled-task fallback and for local testing, but a daemon is preferred — see
*Deploying* below.

## REST API

Mounted at `bitmorse.com/airports-api`. Routes are matched by their trailing
segments, so the same code works under any base path.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/airports-api/health` | liveness + collector poll activity |
| GET | `/airports-api/{icao}/movements?days=60` | per-runway-end 24h histogram |
| GET | `/airports-api/{icao}/summary?days=60` | totals, distinct days, busiest hour |
| GET | `/airports-api/{icao}/weather?days=60` | hourly weather (recent observed + forecast) |

`{icao}` is case-insensitive and must be a configured airport (`LSZH`, `VTBS`).
`days` is clamped to the 60-day window. Responses are gzip-friendly JSON with
`Cache-Control: public, max-age=300` and a data-based `ETag`, so a reopened card
revalidates to a cheap `304`. Fetch **on open, not on a poll.** Full field
reference in `api.md`.

The `movements` payload mirrors the frontend's `RunwayHistogram` shape
(`src/domain/movementStats.ts`): `ends[]` busiest-first, each with 24 `hours`. The
`weather` payload is `{ icao, hours[] }` — the **full hourly field set** (wind at
10 m and 80 m, gusts, temp, dew point, humidity, apparent temp, precip/rain/
showers/snow, weather code, visibility, cloud total + low/mid/high, surface and
MSL pressure, CAPE, freezing level, precip probability); past `tsUtc` = observed,
future = forecast. Wind drives runway selection, so this is the basis for a future
weather → runway-utilisation predictor (see the plan). `/health` also carries a
`db` flag (`false` before the collector's first run — the API stays up).

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
   The DB (and any transient `-journal`) must never be web-served. If `src/`,
   `config/` or `data/` do end up under the docroot, deny them (`data/.htaccess`
   already does this). The API opens the DB read-only, so the web user needs only
   read permission on it — no WAL sidecars are involved.
4. **Run the collector — as a Daemon (recommended).** Needs a server type with
   daemons (e.g. *Kitchen Sink*). NFS scheduled tasks fire at most ~every 10 min
   *and* are time-limited (~3 min), so they can't poll continuously; a **Daemon**
   (Site → *Manage Daemons*) has neither limit and NFS restarts it if it dies.
   The daemon page can't pass arguments, so use the bundled run script
   `bin/daemon.sh` (it runs `collect.php --forever --every 30 --all`):
   - **Tag:** `collect`
   - **Command Line:** `/home/protected/backend/bin/daemon.sh` (make it executable:
     `chmod +x /home/protected/backend/bin/daemon.sh`)
   - **Working Directory:** `/home/protected/backend` (any value works — the script
     uses absolute paths)
   - **Run Daemon As:** `me` — so it runs as your member user, owns the DB, and
     writes with no permission fiddling. (If you must run it as `web`, make the
     data dir writable by web: `chmod 777 /home/protected/backend/data` and delete
     any existing `bitmorse`-owned `stats.db*` so the web daemon recreates it.)
   - No `ZRH_DB` needed — the script's default DB path matches the API's.
   - Mostly asleep between polls (low CPU/RAU).

   **Alternative — Scheduled Task** (if you'd rather not run a daemon): fire it at
   the panel's max frequency with a loop that stays under the task time limit:
   - Command: `php /home/protected/backend/bin/collect.php --loop 150 --every 30 --all`
   - This polls for ~2.5 min each kick, then idles until the next. It only covers
     part of each interval, so it **samples** movements (undercounts totals) but
     still captures the relative busy-hours / per-runway shape. Prefer the daemon
     for accurate counts.
5. **Verify:** open `/airports-api/health` — `polls10m` should climb toward ~18–20
   once the daemon has been running 10 minutes. If it's `0` and `lastPollAgoS`
   keeps growing, the collector isn't running.
6. **Dead-man's switch (optional, scheduled-task mode only).** Set
   `ZRH_HEALTHCHECK_URL` to a healthchecks.io ping URL; the collector pings it
   after a successful finite run. (In `--forever` mode, monitor via `/health`
   `polls10m` instead.)

Then check `https://bitmorse.com/airports-api/health` returns `{"ok":true, ...}`.

## Bandwidth & storage

- Collector fetches ~15–20 KB per airport per poll → ~50–60 MB/day per airport at
  30s cadence (so `--all` with 2 airports ≈ 100–120 MB/day). Well under the
  1 GB/day limit.
- The read API is fetched on card-open (not polled) and cached, so 100 users add
  negligible traffic.
- Storage: aggregates only. ~60 days of movements is a few MB; `tracker` is
  bounded by the count of currently-airborne aircraft; `poll_log` holds ~2h of
  heartbeats; `weather` is ~9k rows/airport/year (365-day retention, negligible).
- Weather adds one small Open-Meteo JSON fetch per airport every ~15 min
  (`weatherEverySeconds`) — a rounding error against the movement traffic.

## Operations

- **Monitoring.** The daemon self-monitors via `/airports-api/health`:
  `polls10m` ≈ 18–20 when healthy (a poll every 30s), and `lastPollAgoS` stays
  small. If `polls10m` is 0 and `lastPollAgoS` grows past ~600, the daemon is
  down.
- **Daemon log.** In `--forever` mode stdout is intentionally quiet: an `alive:`
  summary every 10 minutes plus any errors. Per-poll detail is suppressed to keep
  the log bounded.
- **Resilience.** Each poll and the heartbeat write are individually guarded, so a
  provider outage or a transient DB lock is logged and retried, not fatal. On a
  fatal startup error the process backs off before exiting so NFS's restart can't
  hot-loop.
- **DB must exist for the API.** The API is read-only and won't create the file;
  the daemon (or one manual `collect.php LSZH`) creates it on first poll.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| API returns `{"error":"backend root not found"}` (500) | `index.php` can't locate `src/`. Set `SetEnv ZRH_BACKEND_ROOT /home/protected/backend` in the web `.htaccess` (it also falls back to that path automatically). |
| API returns `{"error":"internal error"}` (500) | Usually the DB: it doesn't exist yet (run the collector once) or the web user can't read it. The API is read-only + rollback-journal, so read permission is enough. Reproduce the real error from CLI: `php -r 'require ".../src/bootstrap.php"; $c=require ".../config/app.php"; Zrh\Store::openReader($c["db"]);'`. |
| API returns `{"error":"not found"}` (404) | Expected for the bare `/airports-api` (it's the mount, not a route). Use `/airports-api/health` etc. |
| PHP not executing (source shown / blank) | The site's Server Type must include PHP **and** daemons — use *Kitchen Sink*. |
| `php: not found` in the daemon log | Set the full path in `bin/daemon.sh` (find it with `which php`, usually `/usr/local/bin/php`). |
| Daemon writes fail with permission errors | Run the daemon as `me` (owns the DB), or make `data/` writable by `web`. |

## Known limitations

- **Cadence:** 30s polling can miss a fast touch-and-go, and a movement is bucketed
  to the poll time (±30s) so a movement near an hour/day boundary can land in the
  adjacent bucket. Aggregate counts are unaffected; fine for the histogram.
- **Cold-start / coverage gaps:** a landing is an air→ground transition, so an
  aircraft first seen already on the ground (e.g. the poll right after a daemon
  restart, or a low-coverage final) isn't counted — a small, bounded undercount.
- **Detection is a reduced heuristic**, independent of the frontend's — the two can
  drift slightly. No clearance-wait / airline / destination stats yet (the schema
  keeps `hex` per movement so those can be added without a migration).
- **Concurrency (rollback-journal over NFS):** the read API and the single writer
  can briefly block each other; a 15s `busy_timeout` and short, atomic
  transactions keep this rare. There's no rate limiting on the public read
  endpoints — acceptable for this traffic; a cached/static read path would be the
  upgrade if load ever warrants it.
