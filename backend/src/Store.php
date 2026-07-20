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
        // WAL keeps the read API from blocking the collector's writes.
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $s = new self($pdo);
        $s->migrate();
        return $s;
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
                PRIMARY KEY (icao, hex)
            );
        SQL);
    }

    /**
     * @param array<int,array{kind:string,hex:string,end:string,ts:int}> $movements
     */
    public function insertMovements(string $icao, array $movements, string $timeZone, string $source = 'collector'): int
    {
        if ($movements === []) {
            return 0;
        }
        $tz = new \DateTimeZone($timeZone);
        $stmt = $this->pdo->prepare(
            'INSERT INTO movements (icao, ts_utc, local_date, local_hour, kind, rwy_end, hex, source)
             VALUES (:icao, :ts, :date, :hour, :kind, :end, :hex, :source)'
        );
        $this->pdo->beginTransaction();
        try {
            foreach ($movements as $m) {
                $b = self::localBucket((int) $m['ts'], $tz);
                $stmt->execute([
                    ':icao' => $icao,
                    ':ts' => (int) $m['ts'],
                    ':date' => $b['date'],
                    ':hour' => $b['hour'],
                    ':kind' => $m['kind'],
                    ':end' => $m['end'],
                    ':hex' => $m['hex'] ?? null,
                    ':source' => $source,
                ]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        return count($movements);
    }

    /** @return array<string,array{onground:int,alt_agl:?float,seen:int,takeoff_at:?int,landing_at:?int}> */
    public function loadTracker(string $icao): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT hex, onground, alt_agl, seen, takeoff_at, landing_at FROM tracker WHERE icao = ?'
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
            ];
        }
        return $out;
    }

    /** Replace this airport's tracker wholesale (rows absent from $tracker are dropped). */
    public function saveTracker(string $icao, array $tracker): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('DELETE FROM tracker WHERE icao = ?')->execute([$icao]);
            $stmt = $this->pdo->prepare(
                'INSERT INTO tracker (icao, hex, onground, alt_agl, seen, takeoff_at, landing_at)
                 VALUES (:icao, :hex, :onground, :alt_agl, :seen, :takeoff_at, :landing_at)'
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
                ]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /** Delete movements strictly older than $cutoffMs; returns the row count removed. */
    public function pruneMovements(string $icao, int $cutoffMs): int
    {
        $stmt = $this->pdo->prepare('DELETE FROM movements WHERE icao = ? AND ts_utc < ?');
        $stmt->execute([$icao, $cutoffMs]);
        return $stmt->rowCount();
    }

    /**
     * Per-runway-end 24-hour histogram since $sinceMs, busiest end first. Mirrors
     * the frontend's RunwayHistogram shape (src/domain/movementStats.ts).
     */
    public function histogram(string $icao, int $sinceMs): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT rwy_end, local_hour, kind, local_date, COUNT(*) AS c
             FROM movements WHERE icao = ? AND ts_utc >= ?
             GROUP BY rwy_end, local_hour, kind, local_date'
        );
        $stmt->execute([$icao, $sinceMs]);

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
