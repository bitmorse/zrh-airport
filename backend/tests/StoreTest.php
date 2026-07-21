<?php

declare(strict_types=1);

use Zrh\Store;

/**
 * SQLite persistence: movement rows bucketed by airport-local hour, the tracker
 * blob that carries detector state between cron runs, retention pruning, and the
 * histogram/summary read queries that back the REST API.
 */

function memStore(): Store
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $s = new Store($pdo);
    $s->migrate();
    return $s;
}

const TZ = 'Europe/Zurich';

function mv(string $kind, string $hex, string $end, int $ts): array
{
    return ['kind' => $kind, 'hex' => $hex, 'end' => $end, 'ts' => $ts];
}

/** A tracker row with the fields Store persists. */
function trk(int $onground, ?string $lastEnd = null, int $seen = 1): array
{
    return [
        'onground' => $onground, 'alt_agl' => null, 'seen' => $seen,
        'takeoff_at' => null, 'landing_at' => null, 'last_end' => $lastEnd,
    ];
}

/** A normalised weather row (as Weather::normalise emits), with sane defaults. */
function wx(int $tsMs, array $over = []): array
{
    return array_merge([
        'tsMs' => $tsMs,
        'windDir' => null, 'windKt' => null, 'gustKt' => null,
        'tempC' => null, 'precipMm' => null, 'visibilityM' => null,
        'cloudPct' => null, 'pressureHpa' => null,
    ], $over);
}

return [
    'migrate: creates movements and tracker tables' => function (): void {
        $s = memStore();
        $names = $s->pdo->query(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )->fetchAll(PDO::FETCH_COLUMN);
        Assert::true(in_array('movements', $names, true), 'movements table');
        Assert::true(in_array('tracker', $names, true), 'tracker table');
    },

    'insert + histogram: buckets by local hour and runway end' => function (): void {
        $s = memStore();
        // Two landings on 14 at 14:xx local, one takeoff on 16 at 09:xx local.
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '14', tsAt('2026-07-17 14:10:00', TZ)),
            mv('landing', 'b', '14', tsAt('2026-07-17 14:50:00', TZ)),
            mv('takeoff', 'c', '16', tsAt('2026-07-17 09:20:00', TZ)),
        ], TZ);

        $h = $s->histogram('LSZH', 0);
        $byEnd = [];
        foreach ($h['ends'] as $e) {
            $byEnd[$e['end']] = $e;
        }
        Assert::same(2, $byEnd['14']['landings'], '14 landings');
        Assert::same(0, $byEnd['14']['takeoffs'], '14 takeoffs');
        Assert::same(2, $byEnd['14']['hours'][14]['landings'], '14 landings in hour 14');
        Assert::same(1, $byEnd['16']['hours'][9]['takeoffs'], '16 takeoff in hour 9');
        Assert::same(3, $h['totals']['landings'] + $h['totals']['takeoffs'], 'total movements');
        Assert::same(1, $h['totals']['days'], 'one distinct local day');
    },

    'histogram: busiest end sorts first' => function (): void {
        $s = memStore();
        $t = tsAt('2026-07-17 12:00:00', TZ);
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '28', $t),
            mv('landing', 'b', '14', $t),
            mv('landing', 'c', '14', $t),
            mv('takeoff', 'd', '14', $t),
        ], TZ);
        $h = $s->histogram('LSZH', 0);
        Assert::same('14', $h['ends'][0]['end'], 'busiest end (14) first');
    },

    'histogram: respects the since cutoff' => function (): void {
        $s = memStore();
        $s->insertMovements('LSZH', [
            mv('landing', 'old', '14', tsAt('2026-05-01 12:00:00', TZ)),
            mv('landing', 'new', '14', tsAt('2026-07-17 12:00:00', TZ)),
        ], TZ);
        $cut = tsAt('2026-07-01 00:00:00', TZ);
        $h = $s->histogram('LSZH', $cut);
        Assert::same(1, $h['totals']['landings'], 'only movements after cutoff');
    },

    'histogram: date filters to one local calendar day (the today view)' => function (): void {
        $s = memStore();
        // Two days of traffic; the "today" filter must return only the named day,
        // so hours the other day had are empty rather than wrapping in.
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '14', tsAt('2026-07-20 22:00:00', TZ)), // yesterday 22:00
            mv('landing', 'b', '14', tsAt('2026-07-21 08:00:00', TZ)), // today 08:00
        ], TZ);
        $h = $s->histogram('LSZH', 0, null, '2026-07-21');
        Assert::same(1, $h['totals']['landings'], 'only the requested day');
        $e = $h['ends'][0];
        Assert::same(1, $e['hours'][8]['landings'], 'today 08:00 present');
        Assert::same(0, $e['hours'][22]['landings'], "yesterday's 22:00 excluded (no future/wrap)");
    },

    'histogram: dow filters to one local weekday' => function (): void {
        $s = memStore();
        // 2026-07-17 is a Friday (dow 5); 2026-07-18 a Saturday (dow 6).
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '14', tsAt('2026-07-17 14:00:00', TZ)), // Fri
            mv('landing', 'b', '14', tsAt('2026-07-18 14:00:00', TZ)), // Sat
        ], TZ);
        Assert::same(1, $s->histogram('LSZH', 0, 5)['totals']['landings'], 'only Friday');
        Assert::same(1, $s->histogram('LSZH', 0, 6)['totals']['landings'], 'only Saturday');
        Assert::same(2, $s->histogram('LSZH', 0, null)['totals']['landings'], 'all days');
        Assert::same(0, $s->histogram('LSZH', 0, 1)['totals']['landings'], 'no Mondays');
    },

    'recentByEnd: counts per end in the window, busiest first' => function (): void {
        $s = memStore();
        $now = tsAt('2026-07-20 12:00:00', TZ);
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '28', $now - 10 * 60_000),
            mv('landing', 'b', '28', $now - 20 * 60_000),
            mv('takeoff', 'c', '28', $now - 30 * 60_000),
            mv('landing', 'd', '16', $now - 5 * 60_000),
            mv('landing', 'e', '16', tsAt('2026-07-20 09:00:00', TZ)), // outside a 90-min window
        ], TZ);
        $r = $s->recentByEnd('LSZH', $now - 90 * 60_000);
        Assert::same('28', $r['ends'][0]['end'], 'busiest end first');
        Assert::same(3, $r['ends'][0]['movements'], '28 has 3 recent');
        Assert::same(2, $r['ends'][0]['landings'], '28 landings');
        Assert::same(1, $r['ends'][0]['takeoffs'], '28 takeoffs');
        Assert::same(1, $r['ends'][1]['movements'], '16 has 1 recent (old one excluded)');
    },

    'tracker: round-trips state and replaces on save' => function (): void {
        $s = memStore();
        $s->saveTracker('LSZH', [
            'abc' => ['onground' => 0, 'alt_agl' => 900.0, 'seen' => 123, 'takeoff_at' => null, 'landing_at' => 111],
        ]);
        $loaded = $s->loadTracker('LSZH');
        Assert::true(isset($loaded['abc']), 'abc present');
        Assert::same(0, (int) $loaded['abc']['onground'], 'onground');
        Assert::same(111, (int) $loaded['abc']['landing_at'], 'landing_at');
        Assert::true($loaded['abc']['takeoff_at'] === null, 'takeoff_at null preserved');

        // Saving a new map replaces the old one wholesale (pruned hexes vanish).
        $s->saveTracker('LSZH', [
            'xyz' => ['onground' => 1, 'alt_agl' => null, 'seen' => 456, 'takeoff_at' => 400, 'landing_at' => null],
        ]);
        $loaded2 = $s->loadTracker('LSZH');
        Assert::false(isset($loaded2['abc']), 'abc pruned');
        Assert::true(isset($loaded2['xyz']), 'xyz present');
    },

    'tracker: isolated per airport' => function (): void {
        $s = memStore();
        $s->saveTracker('LSZH', ['a' => ['onground' => 0, 'alt_agl' => null, 'seen' => 1, 'takeoff_at' => null, 'landing_at' => null]]);
        $s->saveTracker('VTBS', ['b' => ['onground' => 1, 'alt_agl' => null, 'seen' => 2, 'takeoff_at' => null, 'landing_at' => null]]);
        Assert::count(1, $s->loadTracker('LSZH'));
        Assert::count(1, $s->loadTracker('VTBS'));
    },

    'prune: drops movements older than the cutoff' => function (): void {
        $s = memStore();
        $s->insertMovements('LSZH', [
            mv('landing', 'old', '14', tsAt('2026-01-01 12:00:00', TZ)),
            mv('landing', 'new', '14', tsAt('2026-07-17 12:00:00', TZ)),
        ], TZ);
        $removed = $s->pruneMovements('LSZH', tsAt('2026-07-01 00:00:00', TZ));
        Assert::same(1, $removed, 'one row pruned');
        Assert::same(1, $s->histogram('LSZH', 0)['totals']['landings'], 'one remains');
    },

    'summary: totals, distinct days and busiest hour' => function (): void {
        $s = memStore();
        $s->insertMovements('LSZH', [
            mv('landing', 'a', '14', tsAt('2026-07-17 08:05:00', TZ)),
            mv('takeoff', 'b', '16', tsAt('2026-07-18 15:05:00', TZ)),
            mv('takeoff', 'c', '16', tsAt('2026-07-18 15:35:00', TZ)),
        ], TZ);
        $sum = $s->summary('LSZH', 0);
        Assert::same(1, $sum['landings'], 'landings');
        Assert::same(2, $sum['takeoffs'], 'takeoffs');
        Assert::same(2, $sum['days'], 'two distinct days');
        Assert::same(15, $sum['busiestHour'], 'busiest local hour is 15');
    },

    'poll log: counts heartbeats in a window and reports the last one' => function (): void {
        $s = memStore();
        $t0 = tsAt('2026-07-20 12:00:00', TZ);
        for ($i = 0; $i < 5; $i++) {
            $s->recordPoll($t0 + $i * 30_000);
        }
        $act = $s->pollActivity($t0);
        Assert::same(5, $act['count'], 'five polls counted');
        Assert::same($t0 + 4 * 30_000, $act['lastMs'], 'last poll ts');
    },

    'poll log: window excludes older heartbeats' => function (): void {
        $s = memStore();
        $t0 = tsAt('2026-07-20 12:00:00', TZ);
        $s->recordPoll($t0 - 20 * 60_000); // 20 min ago
        $s->recordPoll($t0 - 60_000);      // 1 min ago
        $act = $s->pollActivity($t0 - 10 * 60_000); // last 10 min
        Assert::same(1, $act['count'], 'only the recent poll');
    },

    'poll log: empty -> zero count and null last' => function (): void {
        $s = memStore();
        $act = $s->pollActivity(0);
        Assert::same(0, $act['count']);
        Assert::true($act['lastMs'] === null, 'null last when empty');
    },

    'openReader: reads data but refuses writes (read-only API user)' => function (): void {
        $tmp = sys_get_temp_dir() . '/zrh-ro-' . getmypid() . '.db';
        @unlink($tmp);
        $w = Store::open($tmp);
        $w->insertMovements('LSZH', [mv('landing', 'a', '14', tsAt('2026-07-17 14:00:00', TZ))], TZ);

        $r = Store::openReader($tmp);
        Assert::same(1, $r->histogram('LSZH', 0)['totals']['landings'], 'reader can SELECT');

        $threw = false;
        try {
            $r->insertMovements('LSZH', [mv('takeoff', 'b', '16', tsAt('2026-07-17 15:00:00', TZ))], TZ);
        } catch (\Throwable $e) {
            $threw = true;
        }
        Assert::true($threw, 'reader rejects writes');
        @unlink($tmp);
    },

    'openReader: missing database throws a clear error' => function (): void {
        $threw = false;
        try {
            Store::openReader('/nonexistent/zrh-nope.db');
        } catch (\Throwable $e) {
            $threw = str_contains($e->getMessage(), 'not found');
        }
        Assert::true($threw, 'clear not-found error');
    },

    'poll log: prunes heartbeats older than the retention window' => function (): void {
        $s = memStore();
        $t0 = tsAt('2026-07-20 12:00:00', TZ);
        $s->recordPoll($t0 - 3 * 3_600_000); // 3h ago
        $s->recordPoll($t0);
        $act = $s->pollActivity($t0 - 24 * 3_600_000); // wide window
        Assert::same(1, $act['count'], '3h-old heartbeat pruned');
    },

    'tracker: round-trips last_end (approach-end memory)' => function (): void {
        $s = memStore();
        $s->saveTracker('LSZH', ['a' => trk(0, '28')]);
        Assert::same('28', $s->loadTracker('LSZH')['a']['last_end'], 'last_end persisted');
    },

    'commitCycle: persists movements and tracker together' => function (): void {
        $s = memStore();
        $ts = tsAt('2026-07-17 14:00:00', TZ);
        $s->commitCycle('LSZH', [mv('landing', 'a', '14', $ts)], ['a' => trk(1, '14')], TZ);
        Assert::same(1, $s->histogram('LSZH', 0)['totals']['landings'], 'movement persisted');
        Assert::same('14', $s->loadTracker('LSZH')['a']['last_end'], 'tracker persisted');
    },

    'commitCycle: a failure rolls back BOTH movements and tracker (atomic)' => function (): void {
        $s = memStore();
        $threw = false;
        try {
            // kind=null violates NOT NULL; the whole cycle must roll back.
            $s->commitCycle('LSZH',
                [['kind' => null, 'hex' => 'a', 'end' => '14', 'ts' => tsAt('2026-07-17 14:00:00', TZ)]],
                ['a' => trk(1, '14')],
                TZ);
        } catch (\Throwable $e) {
            $threw = true;
        }
        Assert::true($threw, 'commitCycle threw');
        Assert::same(0, $s->histogram('LSZH', 0)['totals']['landings'], 'no movement leaked');
        Assert::count(0, $s->loadTracker('LSZH'), 'tracker rolled back too');
    },

    'migrate: adds new columns to a pre-existing old-schema DB without data loss' => function (): void {
        $pdo = new PDO('sqlite::memory:');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        // Simulate the previously-deployed schema (no last_end; only the original
        // weather fields), with a row in each.
        $pdo->exec('CREATE TABLE tracker (icao TEXT, hex TEXT, onground INT, alt_agl REAL, seen INT, takeoff_at INT, landing_at INT, PRIMARY KEY(icao,hex))');
        $pdo->exec("INSERT INTO tracker (icao,hex,onground,seen) VALUES ('LSZH','old',0,123)");
        $pdo->exec('CREATE TABLE weather (icao TEXT, ts_utc INT, local_date TEXT, local_hour INT, wind_dir INT, wind_kt REAL, gust_kt REAL, temp_c REAL, precip_mm REAL, visibility_m REAL, cloud_pct REAL, pressure_hpa REAL, fetched_at INT, PRIMARY KEY(icao,ts_utc))');
        $pdo->exec("INSERT INTO weather (icao,ts_utc,local_date,local_hour,wind_dir,fetched_at) VALUES ('LSZH',1000,'2026-07-20',12,240,1000)");

        $s = new Store($pdo);
        $s->migrate();

        $trkCols = $pdo->query('PRAGMA table_info(tracker)')->fetchAll(PDO::FETCH_COLUMN, 1);
        Assert::true(in_array('last_end', $trkCols, true), 'tracker.last_end added');
        $wxCols = $pdo->query('PRAGMA table_info(weather)')->fetchAll(PDO::FETCH_COLUMN, 1);
        Assert::true(in_array('humidity_pct', $wxCols, true), 'weather.humidity_pct added');
        Assert::true(in_array('pressure_msl_hpa', $wxCols, true), 'weather.pressure_msl_hpa added');

        // Old rows survived and read back through the new accessors.
        Assert::same(0, $s->loadTracker('LSZH')['old']['onground'], 'old tracker row intact');
        $w = $s->weather('LSZH', 0);
        Assert::same(240, $w[0]['windDir'], 'old weather row intact via new read');
        Assert::true($w[0]['humidityPct'] === null, 'new field null for the old row');
    },

    'migrate: creates the weather table' => function (): void {
        $s = memStore();
        $names = $s->pdo->query("SELECT name FROM sqlite_master WHERE type='table'")
            ->fetchAll(PDO::FETCH_COLUMN);
        Assert::true(in_array('weather', $names, true), 'weather table');
    },

    'weather: upsert stores hourly rows, bucketed to local hour, read back in order' => function (): void {
        $s = memStore();
        $h12 = tsAt('2026-07-20 12:00:00', 'UTC');
        $h13 = tsAt('2026-07-20 13:00:00', 'UTC');
        $s->upsertWeather('LSZH', [
            wx($h13, ['windDir' => 250, 'windKt' => 12.0]),
            wx($h12, ['windDir' => 240, 'windKt' => 8.0]),
        ], TZ, $h13);

        $rows = $s->weather('LSZH', 0);
        Assert::count(2, $rows, 'two hours');
        Assert::same($h12, $rows[0]['tsUtc'], 'ordered by ts ascending');
        Assert::same(240, $rows[0]['windDir'], 'wind dir');
        Assert::near(8.0, $rows[0]['windKt'], 1e-9, 'wind kt');
        // 12:00 UTC is 14:00 in Zurich summer (UTC+2).
        Assert::same(14, $rows[0]['localHour'], 'bucketed to local hour');
    },

    'weather: re-upserting the same hour updates in place (forecast refines)' => function (): void {
        $s = memStore();
        $h = tsAt('2026-07-20 12:00:00', 'UTC');
        $s->upsertWeather('LSZH', [wx($h, ['windDir' => 240, 'windKt' => 8.0])], TZ, $h);
        $s->upsertWeather('LSZH', [wx($h, ['windDir' => 300, 'windKt' => 20.0])], TZ, $h + 3_600_000);

        $rows = $s->weather('LSZH', 0);
        Assert::count(1, $rows, 'still one row for that hour');
        Assert::same(300, $rows[0]['windDir'], 'updated wind dir');
        Assert::near(20.0, $rows[0]['windKt'], 1e-9, 'updated wind kt');
    },

    'weather: read respects the since cutoff but includes future forecast hours' => function (): void {
        $s = memStore();
        $now = tsAt('2026-07-20 12:00:00', 'UTC');
        $s->upsertWeather('LSZH', [
            wx($now - 48 * 3_600_000, ['windDir' => 100]), // 2 days ago
            wx($now - 1 * 3_600_000, ['windDir' => 200]),  // recent
            wx($now + 6 * 3_600_000, ['windDir' => 300]),  // forecast
        ], TZ, $now);

        $rows = $s->weather('LSZH', $now - 24 * 3_600_000); // last 24h onward
        Assert::count(2, $rows, 'excludes the 2-day-old hour, keeps recent + forecast');
        Assert::same(300, $rows[count($rows) - 1]['windDir'], 'forecast hour included last');
    },

    'weather: prune drops hours older than the cutoff' => function (): void {
        $s = memStore();
        $now = tsAt('2026-07-20 12:00:00', 'UTC');
        $s->upsertWeather('LSZH', [
            wx($now - 400 * 24 * 3_600_000, ['windDir' => 100]), // ~400 days ago
            wx($now, ['windDir' => 200]),
        ], TZ, $now);
        $removed = $s->pruneWeather('LSZH', $now - 365 * 24 * 3_600_000);
        Assert::same(1, $removed, 'one old hour pruned');
        Assert::count(1, $s->weather('LSZH', 0), 'one remains');
    },
];
