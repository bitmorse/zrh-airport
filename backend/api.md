# zrh-airport stats API

Read-only HTTP API serving airport movement statistics (landings and takeoffs
per runway) collected around the clock by the backend collector.

- **Base URL:** `https://bitmorse.com/airports-api`
- **Format:** JSON (`application/json; charset=utf-8`)
- **Auth:** none — public, read-only
- **Methods:** `GET`, `HEAD`, `OPTIONS` (any other verb → `405`)
- **CORS:** `Access-Control-Allow-Origin: *`

## Conventions

- **`{icao}`** is a 4-letter ICAO code, **case-insensitive** (`lszh` == `LSZH`).
  It must be a configured airport — currently `LSZH` (Zürich) and `VTBS`
  (Bangkok Suvarnabhumi). Unknown codes return `404`.
- **`days`** query parameter selects the look-back window in whole days, counted
  back from now. Default `60`, clamped to `[1, 60]` (the retention window).
- **Timestamps** (`generatedAt`, `sinceMs`, `lastMovementMs`) are **epoch
  milliseconds, UTC**.
- **Hour buckets** (`hour`, `busiestHour`) are the airport's **local** hour
  `0–23` (e.g. Europe/Zurich for `LSZH`), so "busy at 08:00" means local time.
- **Days** counts are distinct **local calendar days** on which any qualifying
  movement was observed — use them to turn totals into per-day averages.

## Caching

Responses are cacheable and change at most once per collector cycle:

- `Cache-Control: public, max-age=300`
- `ETag: "<hash>"` — fingerprints the **data only** (not the wall clock), so an
  unchanged dataset returns the same tag. Send it back via `If-None-Match` to get
  a cheap `304 Not Modified`.

Fetch **on demand** (e.g. when the Stats card opens), not on a poll loop.

---

## `GET /health`

Liveness **and collector activity** — use it to check the cron actually ran its
full loop. Never cached (`Cache-Control: no-store`).

```
GET /airports-api/health
```

**200**

```json
{
  "ok": true,
  "polls10m": 18,
  "lastPollMs": 1784550112745,
  "lastPollAgoS": 22,
  "generatedAt": 1784550134799
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `ok` | bool | API is up |
| `polls10m` | int | Poll cycles recorded in the last 10 minutes |
| `lastPollMs` | int \| null | Most recent poll, epoch ms UTC; `null` if none |
| `lastPollAgoS` | int \| null | Seconds since the last poll |
| `generatedAt` | int | Server time, epoch ms UTC |

Interpreting `polls10m` (collector runs `--every 30` → a poll every 30s):

- **~18–20** → a full 9-minute loop ran (healthy).
- **Much lower, and `lastPollAgoS` small** → the loop is running now but started recently.
- **`lastPollAgoS` large / growing** (e.g. > 600) → the collector stopped — the
  scheduled task was cancelled, is failing, or isn't firing.

---

## `GET /{icao}/movements`

Per-runway-end 24-hour histogram over the window — the "popular times" data,
split by runway end. Ends are sorted **busiest first** (by total movements).

```
GET /airports-api/LSZH/movements?days=60
```

**200**

```json
{
  "icao": "LSZH",
  "sinceMs": 1779360000000,
  "ends": [
    {
      "end": "14",
      "landings": 128,
      "takeoffs": 4,
      "days": 6,
      "hours": [
        { "hour": 0, "landings": 0, "takeoffs": 0, "days": 0 },
        { "hour": 1, "landings": 0, "takeoffs": 0, "days": 0 },
        "… 24 entries, one per local hour 0–23 …",
        { "hour": 14, "landings": 22, "takeoffs": 1, "days": 5 }
      ]
    },
    {
      "end": "16",
      "landings": 12,
      "takeoffs": 96,
      "days": 6,
      "hours": [ "… 24 entries …" ]
    }
  ],
  "totals": { "landings": 140, "takeoffs": 100, "days": 6 },
  "windowDays": 60,
  "generatedAt": 1784544186140
}
```

### Fields

| Field | Type | Meaning |
|-------|------|---------|
| `icao` | string | Airport queried (normalised uppercase) |
| `sinceMs` | int | Lower bound of the window, epoch ms UTC |
| `ends[]` | array | One entry per observed runway end, busiest first |
| `ends[].end` | string | Runway-end id, e.g. `"14"`, `"28"`, `"02L"` |
| `ends[].landings` | int | Landings on this end in the window |
| `ends[].takeoffs` | int | Takeoffs on this end in the window |
| `ends[].days` | int | Distinct local days this end saw any movement |
| `ends[].hours[]` | array | Exactly 24 entries; **array index == local hour** |
| `ends[].hours[].hour` | int | Local hour `0–23` |
| `ends[].hours[].landings` | int | Landings on this end in that hour (summed over all days) |
| `ends[].hours[].takeoffs` | int | Takeoffs on this end in that hour |
| `ends[].hours[].days` | int | Distinct days this end-hour was seen (for per-day averages) |
| `totals` | object | Totals across all ends: `landings`, `takeoffs`, `days` |
| `windowDays` | int | Effective window after clamping |
| `generatedAt` | int | Server time when the response was built, epoch ms UTC |

> An empty airport (nothing collected yet, or outside the window) returns
> `"ends": []` and zeroed `totals` — still `200`.

---

## `GET /{icao}/summary`

Headline numbers for a compact stat card.

```
GET /airports-api/LSZH/summary?days=60
```

**200**

```json
{
  "icao": "LSZH",
  "landings": 140,
  "takeoffs": 100,
  "days": 6,
  "busiestHour": 8,
  "lastMovementMs": 1784466300000,
  "windowDays": 60,
  "generatedAt": 1784544186140
}
```

### Fields

| Field | Type | Meaning |
|-------|------|---------|
| `icao` | string | Airport queried |
| `landings` | int | Total landings in the window |
| `takeoffs` | int | Total takeoffs in the window |
| `days` | int | Distinct local days with any movement |
| `busiestHour` | int \| null | Local hour `0–23` with the most movements; `null` if no data |
| `lastMovementMs` | int \| null | Most recent movement, epoch ms UTC; `null` if none |
| `windowDays` | int | Effective window after clamping |
| `generatedAt` | int | Server time, epoch ms UTC |

---

## Errors

All errors are JSON with an `error` string.

| Status | Body | When |
|--------|------|------|
| `404` | `{"error":"not found"}` | Path matches no route (e.g. the bare `/airports-api`) |
| `404` | `{"error":"unknown airport"}` | `{icao}` isn't a configured airport |
| `405` | *(empty; `Allow: GET, HEAD, OPTIONS`)* | Non-GET/HEAD verb |
| `500` | `{"error":"internal error"}` | Server-side failure (e.g. DB unreadable) |

`OPTIONS` preflight returns `204` with CORS headers.

---

## Examples

```bash
# Is it up?
curl https://bitmorse.com/airports-api/health

# Headline stats for the last 7 days
curl "https://bitmorse.com/airports-api/LSZH/summary?days=7"

# Full histogram, then read runway 14's 8 o'clock landings
curl -s "https://bitmorse.com/airports-api/LSZH/movements" \
  | jq '.ends[] | select(.end=="14") | .hours[8]'

# Conditional GET — revalidate with the ETag you got last time
curl -s -D - -o /dev/null \
  -H 'If-None-Match: "abc123def4567890"' \
  "https://bitmorse.com/airports-api/LSZH/summary"   # → 304 if unchanged
```

## Notes & caveats

- Detection is a heuristic run every ~30s (see the collector). Counts are
  aggregate-accurate but can miss the occasional fast touch-and-go, and a runway
  end is inferred from track + geometry.
- History is retained for **60 days**; older movements are pruned.
- Per-day averages: divide an end/hour total by its `days` count, not by the
  window length, so quiet days don't dilute the average.
