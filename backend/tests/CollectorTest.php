<?php

declare(strict_types=1);

use Zrh\Airport;
use Zrh\Collector;
use Zrh\Store;

/**
 * End-to-end of one collector cycle: load tracker → (injected) snapshot → detect
 * → persist movements + tracker → prune. Uses an in-memory store and a fake
 * aircraft feed so it never touches the network.
 */
return [
    'runCycle: a two-poll approach records one landing and persists tracker' => function (): void {
        $ap = Airport::load('LSZH', __DIR__ . '/../config/airports.json');
        $pdo = new PDO('sqlite::memory:');
        $store = new Store($pdo);
        $store->migrate();

        $e = null;
        foreach ($ap->ends as $end) {
            if ($end['id'] === '14') {
                $e = $end;
            }
        }
        $thr = $e['threshold'];

        // Poll 1: on final to 14, airborne descending.
        $t1 = 1_700_000_000_000;
        $r1 = Collector::runCycle($ap, $store, fn () => [[
            'hex' => 'aabbcc', 'lat' => $thr['lat'], 'lon' => $thr['lon'],
            'altFt' => 1416 + 140, 'onGround' => false, 'gs' => 140,
            'track' => $e['bearingDeg'], 'verticalRateFpm' => -700,
        ]], $t1);
        Assert::same(0, $r1['movements'], 'no movement yet');
        Assert::same(1, $r1['tracked'], 'aircraft tracked across polls');

        // Poll 2 (+60s): on the ground rolling out.
        $t2 = $t1 + 60_000;
        $r2 = Collector::runCycle($ap, $store, fn () => [[
            'hex' => 'aabbcc', 'lat' => $thr['lat'], 'lon' => $thr['lon'],
            'altFt' => null, 'onGround' => true, 'gs' => 40,
            'track' => $e['bearingDeg'], 'verticalRateFpm' => null,
        ]], $t2);
        Assert::same(1, $r2['movements'], 'one landing recorded');

        $h = $store->histogram('LSZH', 0);
        Assert::same(1, $h['totals']['landings'], 'landing persisted to db');
        Assert::same('14', $h['ends'][0]['end'], 'tagged to runway 14');
    },

    'runCycle: prunes movements beyond retention' => function (): void {
        $ap = Airport::load('LSZH', __DIR__ . '/../config/airports.json');
        $pdo = new PDO('sqlite::memory:');
        $store = new Store($pdo);
        $store->migrate();

        // Seed an ancient movement directly.
        $store->insertMovements('LSZH', [
            ['kind' => 'landing', 'hex' => 'old', 'end' => '14', 'ts' => 1_600_000_000_000],
        ], 'Europe/Zurich');

        $now = 1_700_000_000_000; // ~1157 days later
        $r = Collector::runCycle($ap, $store, fn () => [], $now, 60);
        Assert::same(1, $r['pruned'], 'ancient movement pruned');
        Assert::same(0, $store->histogram('LSZH', 0)['totals']['landings'], 'gone');
    },

    'runWeather: fetches, upserts hourly rows, and prunes old ones' => function (): void {
        $ap = Airport::load('LSZH', __DIR__ . '/../config/airports.json');
        $pdo = new PDO('sqlite::memory:');
        $store = new Store($pdo);
        $store->migrate();

        $now = 1_784_500_000_000;
        // Seed an ancient hour directly, then run a weather cycle with fresh rows.
        $store->upsertWeather('LSZH', [
            ['tsMs' => $now - 400 * 24 * 3_600_000, 'windDir' => 90, 'windKt' => 5.0,
             'gustKt' => null, 'tempC' => null, 'precipMm' => null,
             'visibilityM' => null, 'cloudPct' => null, 'pressureHpa' => null],
        ], 'Europe/Zurich', $now);

        $written = Collector::runWeather($ap, $store, fn () => [
            ['tsMs' => $now, 'windDir' => 240, 'windKt' => 12.0, 'gustKt' => 18.0,
             'tempC' => 24.0, 'precipMm' => 0.0, 'visibilityM' => 20000.0,
             'cloudPct' => 30.0, 'pressureHpa' => 1016.0],
        ], $now, 365);

        Assert::same(1, $written, 'one hour written');
        $rows = $store->weather('LSZH', 0);
        Assert::count(1, $rows, 'ancient hour pruned, fresh hour kept');
        Assert::same(240, $rows[0]['windDir'], 'fresh wind dir stored');
    },
];
