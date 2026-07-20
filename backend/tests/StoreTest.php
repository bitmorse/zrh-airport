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

    'poll log: prunes heartbeats older than the retention window' => function (): void {
        $s = memStore();
        $t0 = tsAt('2026-07-20 12:00:00', TZ);
        $s->recordPoll($t0 - 3 * 3_600_000); // 3h ago
        $s->recordPoll($t0);
        $act = $s->pollActivity($t0 - 24 * 3_600_000); // wide window
        Assert::same(1, $act['count'], '3h-old heartbeat pruned');
    },
];
