<?php

declare(strict_types=1);

namespace Zrh;

/**
 * SQLite persistence for the collector. Two tables:
 *   movements — one row per detected landing/takeoff, pre-bucketed to the
 *               airport-local date+hour at insert time (the timezone is fixed per
 *               airport) so the histogram is a plain GROUP BY;
 *   tracker   — the detector's per-aircraft memory, one row per (icao, hex),
 *               reloaded at the start of each cron run and rewritten at the end.
 *
 * Everything is keyed by ICAO so one database serves every supported airport.
 */
final class Store
{
    public function __construct(public \PDO $pdo)
    {
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    }

    /** Open (creating parent dir if needed) a file-backed SQLite store. */
    public static function open(string $path): self
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $pdo = new \PDO('sqlite:' . $path);
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        // Rollback-journal (DELETE), NOT WAL: on shared hosting the read-only API
        // runs as a different, lower-privilege user that usually can't write the
        // -wal/-shm sidecars or the data dir, which breaks WAL reads. DELETE mode
        // lets a pure-SELECT reader work with only file-level read permission.
        // Setting it here also converts a database left in WAL by an earlier build.
        $pdo->exec('PRAGMA journal_mode = DELETE');
        $pdo->exec('PRAGMA busy_timeout = 15000');
        $s = new self($pdo);
        $s->migrate();
        return $s;
    }

    /**
     * Open the database read-only for the API. Needs only read permission on the
     * DB file (the web-server user typically can't write it), runs no migration,
     * and refuses writes via `PRAGMA query_only`. The collector must have created
     * the file first.
     */
    public static function openReader(string $path): self
    {
        if (!is_file($path)) {
            throw new \RuntimeException("stats database not found: {$path}");
        }
        $pdo = new \PDO('sqlite:' . $path);
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $pdo->exec('PRAGMA busy_timeout = 15000');
        $pdo->exec('PRAGMA query_only = 1');
        return new self($pdo);
    }

    public function migrate(): void
    {
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS movements (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                icao       TEXT    NOT NULL,
                ts_utc     INTEGER NOT NULL,
                local_date TEXT    NOT NULL,
                local_hour INTEGER NOT NULL,
                kind       TEXT    NOT NULL,
                rwy_end    TEXT    NOT NULL,
                hex        TEXT,
                source     TEXT
            );
        SQL);
        $this->pdo->exec('CREATE INDEX IF NOT EXISTS idx_mv_icao_ts ON movements(icao, ts_utc)');
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS tracker (
                icao       TEXT    NOT NULL,
                hex        TEXT    NOT NULL,
                onground   INTEGER NOT NULL,
                alt_agl    REAL,
                seen       INTEGER NOT NULL,
                takeoff_at INTEGER,
                landing_at INTEGER,
                last_end   TEXT,
                PRIMARY KEY (icao, hex)
            );
        SQL);
        // Heartbeat log: one row per collector poll cycle, so /health can report
        // how many polls ran recently (did the cron run its full loop?).
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS poll_log (ts_utc INTEGER NOT NULL)');
        $this->pdo->exec('CREATE INDEX IF NOT EXISTS idx_poll_ts ON poll_log(ts_utc)');
        // Hourly weather, one row per (airport, hour), upserted so forecasts refine
        // toward actuals. Bucketed to airport-local hour to line up with movements.
        // The full field set (not just wind) so the record is mineable later.
        $cols = implode(",\n                ", array_map(
            static fn ($f) => sprintf('%-18s %s', $f[0], $f[1]),
            self::WEATHER_FIELDS,
        ));
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS weather (\n"
            . "                icao       TEXT    NOT NULL,\n"
            . "                ts_utc     INTEGER NOT NULL,\n"
            . "                local_date TEXT    NOT NULL,\n"
            . "                local_hour INTEGER NOT NULL,\n"
            . "                {$cols},\n"
            . "                fetched_at INTEGER NOT NULL,\n"
            . "                PRIMARY KEY (icao, ts_utc)\n"
            . "            );"
        );

        // Idempotent column adds for databases created by an earlier schema.
        $this->addColumnIfMissing('tracker', 'last_end', 'TEXT');
        foreach (self::WEATHER_FIELDS as [$name, $type]) {
            $this->addColumnIfMissing('weather', $name, $type);
        }
    }

    /**
     * Canonical weather field spec — the single source of truth shared by the
     * schema, the upsert/read here, and Weather (the Open-Meteo request +
     * normalise). Each entry: [sqlColumn, sqlType, apiKey, openMeteoKey, isInt].
     * The original wind/temp/precip/cloud/pressure set plus the broadened
     * aviation set so the record captures "entire weather", not just wind.
     */
    public const WEATHER_FIELDS = [
        ['wind_dir', 'INTEGER', 'windDir', 'wind_direction_10m', true],
        ['wind_kt', 'REAL', 'windKt', 'wind_speed_10m', false],
        ['gust_kt', 'REAL', 'gustKt', 'wind_gusts_10m', false],
        ['temp_c', 'REAL', 'tempC', 'temperature_2m', false],
        ['precip_mm', 'REAL', 'precipMm', 'precipitation', false],
        ['visibility_m', 'REAL', 'visibilityM', 'visibility', false],
        ['cloud_pct', 'REAL', 'cloudPct', 'cloud_cover', false],
        ['pressure_hpa', 'REAL', 'pressureHpa', 'surface_pressure', false],
        ['humidity_pct', 'REAL', 'humidityPct', 'relative_humidity_2m', false],
        ['dew_point_c', 'REAL', 'dewPointC', 'dew_point_2m', false],
        ['apparent_temp_c', 'REAL', 'apparentTempC', 'apparent_temperature', false],
        ['rain_mm', 'REAL', 'rainMm', 'rain', false],
        ['showers_mm', 'REAL', 'showersMm', 'showers', false],
        ['snowfall_cm', 'REAL', 'snowfallCm', 'snowfall', false],
        ['snow_depth_m', 'REAL', 'snowDepthM', 'snow_depth', false],
        ['weather_code', 'INTEGER', 'weatherCode', 'weather_code', true],
        ['pressure_msl_hpa', 'REAL', 'pressureMslHpa', 'pressure_msl', false],
        ['cloud_low_pct', 'REAL', 'cloudLowPct', 'cloud_cover_low', false],
        ['cloud_mid_pct', 'REAL', 'cloudMidPct', 'cloud_cover_mid', false],
        ['cloud_high_pct', 'REAL', 'cloudHighPct', 'cloud_cover_high', false],
        ['wind_kt_80m', 'REAL', 'windKt80m', 'wind_speed_80m', false],
        ['wind_dir_80m', 'INTEGER', 'windDir80m', 'wind_direction_80m', true],
        ['cape', 'REAL', 'cape', 'cape', false],
        ['freezing_level_m', 'REAL', 'freezingLevelM', 'freezing_level_height', false],
        ['precip_prob_pct', 'INTEGER', 'precipProbPct', 'precipitation_probability', true],
    ];

    private function addColumnIfMissing(string $table, string $col, string $type): void
    {
        $existing = $this->pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array($col, $existing, true)) {
            $this->pdo->exec("ALTER TABLE {$table} ADD COLUMN {$col} {$type}");
        }
    }

    private const POLL_RETENTION_MS = 2 * 3_600_000; // keep ~2h of heartbeats

    /** Record one poll cycle at $tsMs and prune heartbeats past the retention window. */
    public function recordPoll(int $tsMs): void
    {
        $this->pdo->prepare('INSERT INTO poll_log (ts_utc) VALUES (?)')->execute([$tsMs]);
        $this->pdo->prepare('DELETE FROM poll_log WHERE ts_utc < ?')
            ->execute([$tsMs - self::POLL_RETENTION_MS]);
    }

    /** @return array{count:int,lastMs:?int} polls at or after $sinceMs. */
    public function pollActivity(int $sinceMs): array
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) c, MAX(ts_utc) last FROM poll_log WHERE ts_utc >= ?');
        $stmt->execute([$sinceMs]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC) ?: ['c' => 0, 'last' => null];
        return [
            'count' => (int) $row['c'],
            'lastMs' => $row['last'] === null ? null : (int) $row['last'],
        ];
    }

    /**
     * @param array<int,array{kind:string,hex:string,end:string,ts:int}> $movements
     */
    public function insertMovements(string $icao, array $movements, string $timeZone, string $source = 'collector'): int
    {
        if ($movements === []) {
            return 0;
        }
        $this->tx(fn () => $this->writeMovements($icao, $movements, new \DateTimeZone($timeZone), $source));
        return count($movements);
    }

    /**
     * Persist a poll's movements AND the updated detector tracker in ONE
     * transaction, so a failure can never leave a movement committed without its
     * cooldown/state (which caused the same event to re-count every poll).
     */
    public function commitCycle(string $icao, array $movements, array $tracker, string $timeZone, string $source = 'collector'): int
    {
        $this->tx(function () use ($icao, $movements, $tracker, $timeZone, $source) {
            $this->writeTracker($icao, $tracker);
            if ($movements !== []) {
                $this->writeMovements($icao, $movements, new \DateTimeZone($timeZone), $source);
            }
        });
        return count($movements);
    }

    /** @return array<string,array{onground:int,alt_agl:?float,seen:int,takeoff_at:?int,landing_at:?int,last_end:?string}> */
    public function loadTracker(string $icao): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT hex, onground, alt_agl, seen, takeoff_at, landing_at, last_end FROM tracker WHERE icao = ?'
        );
        $stmt->execute([$icao]);
        $out = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $out[(string) $r['hex']] = [
                'onground' => (int) $r['onground'],
                'alt_agl' => $r['alt_agl'] === null ? null : (float) $r['alt_agl'],
                'seen' => (int) $r['seen'],
                'takeoff_at' => $r['takeoff_at'] === null ? null : (int) $r['takeoff_at'],
                'landing_at' => $r['landing_at'] === null ? null : (int) $r['landing_at'],
                'last_end' => $r['last_end'] === null ? null : (string) $r['last_end'],
            ];
        }
        return $out;
    }

    /** Replace this airport's tracker wholesale (rows absent from $tracker are dropped). */
    public function saveTracker(string $icao, array $tracker): void
    {
        $this->tx(fn () => $this->writeTracker($icao, $tracker));
    }

    /** Run $fn inside a transaction, rolling back and rethrowing on any error. */
    private function tx(callable $fn): void
    {
        $this->pdo->beginTransaction();
        try {
            $fn();
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    /** Insert movement rows (assumes an open transaction). */
    private function writeMovements(string $icao, array $movements, \DateTimeZone $tz, string $source): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO movements (icao, ts_utc, local_date, local_hour, kind, rwy_end, hex, source)
             VALUES (:icao, :ts, :date, :hour, :kind, :end, :hex, :source)'
        );
        foreach ($movements as $m) {
            $b = self::localBucket((int) $m['ts'], $tz);
            $stmt->execute([
                ':icao' => $icao, ':ts' => (int) $m['ts'], ':date' => $b['date'], ':hour' => $b['hour'],
                ':kind' => $m['kind'], ':end' => $m['end'], ':hex' => $m['hex'] ?? null, ':source' => $source,
            ]);
        }
    }

    /** Replace the tracker rows for one airport (assumes an open transaction). */
    private function writeTracker(string $icao, array $tracker): void
    {
        $this->pdo->prepare('DELETE FROM tracker WHERE icao = ?')->execute([$icao]);
        $stmt = $this->pdo->prepare(
            'INSERT INTO tracker (icao, hex, onground, alt_agl, seen, takeoff_at, landing_at, last_end)
             VALUES (:icao, :hex, :onground, :alt_agl, :seen, :takeoff_at, :landing_at, :last_end)'
        );
        foreach ($tracker as $hex => $st) {
            $stmt->execute([
                ':icao' => $icao,
                ':hex' => (string) $hex,
                ':onground' => (int) $st['onground'],
                ':alt_agl' => $st['alt_agl'] ?? null,
                ':seen' => (int) $st['seen'],
                ':takeoff_at' => $st['takeoff_at'] ?? null,
                ':landing_at' => $st['landing_at'] ?? null,
                ':last_end' => $st['last_end'] ?? null,
            ]);
        }
    }

    /** Delete movements strictly older than $cutoffMs; returns the row count removed. */
    public function pruneMovements(string $icao, int $cutoffMs): int
    {
        $stmt = $this->pdo->prepare('DELETE FROM movements WHERE icao = ? AND ts_utc < ?');
        $stmt->execute([$icao, $cutoffMs]);
        return $stmt->rowCount();
    }

    // ---- weather ----

    /**
     * Upsert hourly weather rows (as Weather::normalise emits, keyed by the apiKey
     * of WEATHER_FIELDS). One row per (icao, hour); re-fetching refines it in place.
     * Uses INSERT..ON CONFLICT where available (SQLite ≥ 3.24), else a
     * delete-then-insert fallback so old SQLite doesn't silently drop weather.
     */
    public function upsertWeather(string $icao, array $rows, string $timeZone, int $fetchedAtMs): int
    {
        if ($rows === []) {
            return 0;
        }
        $tz = new \DateTimeZone($timeZone);
        $cols = array_column(self::WEATHER_FIELDS, 0);         // sql columns
        $keys = array_column(self::WEATHER_FIELDS, 2);         // apiKeys (row keys)

        $allCols = array_merge(['icao', 'ts_utc', 'local_date', 'local_hour'], $cols, ['fetched_at']);
        $placeholders = implode(', ', array_map(static fn ($c) => ':' . $c, $allCols));
        $insert = 'INSERT INTO weather (' . implode(', ', $allCols) . ") VALUES ({$placeholders})";

        if (self::supportsUpsert()) {
            $set = implode(', ', array_map(
                static fn ($c) => "{$c} = excluded.{$c}",
                array_merge(['local_date', 'local_hour'], $cols, ['fetched_at']),
            ));
            $sql = $insert . ' ON CONFLICT(icao, ts_utc) DO UPDATE SET ' . $set;
        } else {
            $sql = null; // fallback: delete the hour first, then plain insert
        }

        $this->tx(function () use ($rows, $icao, $tz, $fetchedAtMs, $cols, $keys, $insert, $sql) {
            $stmt = $this->pdo->prepare($sql ?? $insert);
            $del = $sql === null
                ? $this->pdo->prepare('DELETE FROM weather WHERE icao = ? AND ts_utc = ?')
                : null;
            foreach ($rows as $r) {
                $b = self::localBucket((int) $r['tsMs'], $tz);
                if ($del !== null) {
                    $del->execute([$icao, (int) $r['tsMs']]);
                }
                $params = [
                    ':icao' => $icao, ':ts_utc' => (int) $r['tsMs'],
                    ':local_date' => $b['date'], ':local_hour' => $b['hour'],
                    ':fetched_at' => $fetchedAtMs,
                ];
                foreach ($cols as $i => $col) {
                    $params[':' . $col] = $r[$keys[$i]] ?? null;
                }
                $stmt->execute($params);
            }
        });
        return count($rows);
    }

    /**
     * Hourly weather at or after $sinceMs, oldest first. Future forecast hours are
     * included (sinceMs is only a lower bound). Pure SELECT — safe under openReader.
     */
    public function weather(string $icao, int $sinceMs): array
    {
        $cols = array_column(self::WEATHER_FIELDS, 0);
        $select = 'SELECT ts_utc, local_date, local_hour, ' . implode(', ', $cols)
            . ' FROM weather WHERE icao = ? AND ts_utc >= ? ORDER BY ts_utc';
        $stmt = $this->pdo->prepare($select);
        $stmt->execute([$icao, $sinceMs]);
        $out = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $row = [
                'tsUtc' => (int) $r['ts_utc'],
                'localDate' => (string) $r['local_date'],
                'localHour' => (int) $r['local_hour'],
            ];
            foreach (self::WEATHER_FIELDS as [$col, $type, $apiKey]) {
                $v = $r[$col];
                $row[$apiKey] = $v === null ? null : ($type === 'INTEGER' ? (int) $v : (float) $v);
            }
            $out[] = $row;
        }
        return $out;
    }

    /** True if the runtime SQLite supports INSERT..ON CONFLICT (≥ 3.24, 2018). */
    private function supportsUpsert(): bool
    {
        $v = (string) $this->pdo->query('SELECT sqlite_version()')->fetchColumn();
        return version_compare($v, '3.24.0', '>=');
    }

    /** Delete weather hours strictly older than $cutoffMs; returns rows removed. */
    public function pruneWeather(string $icao, int $cutoffMs): int
    {
        $stmt = $this->pdo->prepare('DELETE FROM weather WHERE icao = ? AND ts_utc < ?');
        $stmt->execute([$icao, $cutoffMs]);
        return $stmt->rowCount();
    }

    /**
     * Per-runway-end 24-hour histogram since $sinceMs, busiest end first. Mirrors
     * the frontend's RunwayHistogram shape (src/domain/movementStats.ts). When $dow
     * (0=Sunday..6=Saturday) is given, only movements on that local weekday count —
     * the "what it's usually like on a <weekday>" view.
     */
    public function histogram(string $icao, int $sinceMs, ?int $dow = null): array
    {
        // local_date is the airport-local Y-m-d, so strftime('%w', …) is the local weekday.
        $sql = 'SELECT rwy_end, local_hour, kind, local_date, COUNT(*) AS c
                FROM movements WHERE icao = ? AND ts_utc >= ?';
        $args = [$icao, $sinceMs];
        if ($dow !== null) {
            $sql .= " AND strftime('%w', local_date) = ?";
            $args[] = (string) $dow;
        }
        $sql .= ' GROUP BY rwy_end, local_hour, kind, local_date';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($args);

        $ends = [];
        $totalDays = [];
        $totL = 0;
        $totT = 0;
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $end = (string) $r['rwy_end'];
            $hour = (int) $r['local_hour'];
            $cnt = (int) $r['c'];
            $date = (string) $r['local_date'];
            $isLanding = $r['kind'] === 'landing';

            if (!isset($ends[$end])) {
                $ends[$end] = ['landings' => 0, 'takeoffs' => 0, 'dayset' => [], 'hours' => self::emptyHours()];
            }
            $e = &$ends[$end];
            if ($isLanding) {
                $e['landings'] += $cnt;
                $e['hours'][$hour]['landings'] += $cnt;
                $totL += $cnt;
            } else {
                $e['takeoffs'] += $cnt;
                $e['hours'][$hour]['takeoffs'] += $cnt;
                $totT += $cnt;
            }
            $e['dayset'][$date] = true;
            $e['hours'][$hour]['dayset'][$date] = true;
            $totalDays[$date] = true;
            unset($e);
        }

        $out = [];
        foreach ($ends as $end => $e) {
            $hours = [];
            for ($h = 0; $h < 24; $h++) {
                $hours[] = [
                    'hour' => $h,
                    'landings' => $e['hours'][$h]['landings'],
                    'takeoffs' => $e['hours'][$h]['takeoffs'],
                    'days' => count($e['hours'][$h]['dayset']),
                ];
            }
            $out[] = [
                'end' => (string) $end,
                'landings' => $e['landings'],
                'takeoffs' => $e['takeoffs'],
                'days' => count($e['dayset']),
                'hours' => $hours,
            ];
        }
        usort($out, static function ($a, $b) {
            return ($b['landings'] + $b['takeoffs']) <=> ($a['landings'] + $a['takeoffs'])
                ?: strcmp($a['end'], $b['end']);
        });

        return [
            'icao' => $icao,
            'sinceMs' => $sinceMs,
            'ends' => $out,
            'totals' => ['landings' => $totL, 'takeoffs' => $totT, 'days' => count($totalDays)],
        ];
    }

    /**
     * Per-runway-end movement counts in a recent wall-clock window (since $sinceMs),
     * busiest end first — "which runway is hot right now". Powers the live map heatmap.
     * @return array{icao:string,sinceMs:int,ends:array<int,array{end:string,movements:int,landings:int,takeoffs:int}>}
     */
    public function recentByEnd(string $icao, int $sinceMs): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT rwy_end, kind, COUNT(*) AS c
             FROM movements WHERE icao = ? AND ts_utc >= ?
             GROUP BY rwy_end, kind'
        );
        $stmt->execute([$icao, $sinceMs]);

        $ends = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $end = (string) $r['rwy_end'];
            $cnt = (int) $r['c'];
            if (!isset($ends[$end])) {
                $ends[$end] = ['end' => $end, 'movements' => 0, 'landings' => 0, 'takeoffs' => 0];
            }
            if ($r['kind'] === 'landing') {
                $ends[$end]['landings'] += $cnt;
            } else {
                $ends[$end]['takeoffs'] += $cnt;
            }
            $ends[$end]['movements'] += $cnt;
        }

        $out = array_values($ends);
        usort($out, static fn ($a, $b) => $b['movements'] <=> $a['movements'] ?: strcmp($a['end'], $b['end']));

        return ['icao' => $icao, 'sinceMs' => $sinceMs, 'ends' => $out];
    }

    /** Headline stats for the card: totals, distinct days, busiest local hour, last movement. */
    public function summary(string $icao, int $sinceMs): array
    {
        $counts = $this->pdo->prepare(
            'SELECT kind, COUNT(*) c FROM movements WHERE icao = ? AND ts_utc >= ? GROUP BY kind'
        );
        $counts->execute([$icao, $sinceMs]);
        $landings = 0;
        $takeoffs = 0;
        foreach ($counts->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            if ($r['kind'] === 'landing') {
                $landings = (int) $r['c'];
            } else {
                $takeoffs = (int) $r['c'];
            }
        }

        $days = $this->pdo->prepare('SELECT COUNT(DISTINCT local_date) FROM movements WHERE icao = ? AND ts_utc >= ?');
        $days->execute([$icao, $sinceMs]);

        $busy = $this->pdo->prepare(
            'SELECT local_hour FROM movements WHERE icao = ? AND ts_utc >= ?
             GROUP BY local_hour ORDER BY COUNT(*) DESC, local_hour ASC LIMIT 1'
        );
        $busy->execute([$icao, $sinceMs]);
        $busiest = $busy->fetchColumn();

        $last = $this->pdo->prepare('SELECT MAX(ts_utc) FROM movements WHERE icao = ? AND ts_utc >= ?');
        $last->execute([$icao, $sinceMs]);
        $lastTs = $last->fetchColumn();

        return [
            'icao' => $icao,
            'landings' => $landings,
            'takeoffs' => $takeoffs,
            'days' => (int) $days->fetchColumn(),
            'busiestHour' => $busiest === false ? null : (int) $busiest,
            'lastMovementMs' => $lastTs === null || $lastTs === false ? null : (int) $lastTs,
        ];
    }

    private static function emptyHours(): array
    {
        $h = [];
        for ($i = 0; $i < 24; $i++) {
            $h[$i] = ['landings' => 0, 'takeoffs' => 0, 'dayset' => []];
        }
        return $h;
    }

    /** Airport-local calendar date (Y-m-d) and hour (0..23) for an epoch-ms instant. */
    private static function localBucket(int $tsMs, \DateTimeZone $tz): array
    {
        $dt = (new \DateTimeImmutable('@' . intdiv($tsMs, 1000)))->setTimezone($tz);
        return ['date' => $dt->format('Y-m-d'), 'hour' => (int) $dt->format('G')];
    }
}
