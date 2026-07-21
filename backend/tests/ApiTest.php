<?php

declare(strict_types=1);

use Zrh\Api;
use Zrh\Store;

/**
 * The read-only REST router. Pure function of (store, path, query, opts) →
 * {status, headers, body} so it's testable without a web server.
 */

function apiStore(): Store
{
    $pdo = new PDO('sqlite::memory:');
    $s = new Store($pdo);
    $s->migrate();
    $s->insertMovements('LSZH', [
        ['kind' => 'landing', 'hex' => 'a', 'end' => '14', 'ts' => tsAt('2026-07-17 14:00:00', 'Europe/Zurich')],
        ['kind' => 'takeoff', 'hex' => 'b', 'end' => '16', 'ts' => tsAt('2026-07-17 09:00:00', 'Europe/Zurich')],
    ], 'Europe/Zurich');
    return $s;
}

function apiOpts(): array
{
    return [
        'airports' => ['LSZH', 'VTBS'],
        'nowMs' => tsAt('2026-07-20 00:00:00', 'Europe/Zurich'),
        'defaultWindowDays' => 60,
        'maxWindowDays' => 60,
    ];
}

return [
    'health: 200 ok' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/health', [], apiOpts());
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::true($body['ok'] === true, 'ok true');
    },

    'health: reports recent poll activity, uncached' => function (): void {
        $store = apiStore();
        $opts = apiOpts();
        $now = $opts['nowMs'];
        $store->recordPoll($now - 30_000);
        $store->recordPoll($now - 5_000);
        $store->recordPoll($now - 15 * 60_000); // outside the 10-min window
        $r = Api::handle($store, '/api/v1/health', [], $opts);
        $b = json_decode($r['body'], true);
        Assert::same(2, $b['polls10m'], 'two polls in the last 10 min');
        Assert::same($now - 5_000, $b['lastPollMs'], 'last poll ts');
        Assert::true($b['lastPollAgoS'] >= 4 && $b['lastPollAgoS'] <= 6, 'age ~5s');
        // Health must not be cached — it reflects live status.
        Assert::true(str_contains(strtolower($r['headers']['Cache-Control'] ?? ''), 'no-store'), 'no-store');
    },

    'movements: returns per-end histogram' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/movements', ['days' => '60'], apiOpts());
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::same('LSZH', $body['icao']);
        Assert::same(1, $body['totals']['landings']);
        Assert::same(1, $body['totals']['takeoffs']);
        Assert::true(count($body['ends']) === 2, 'two ends');
    },

    'movements: content-type json and cache header present' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/movements', [], apiOpts());
        Assert::true(str_contains(strtolower($r['headers']['Content-Type'] ?? ''), 'application/json'), 'json ct');
        Assert::true(isset($r['headers']['Cache-Control']), 'cache header');
        Assert::true(isset($r['headers']['ETag']), 'etag');
    },

    'etag: stable across calls with the same data (enables 304)' => function (): void {
        $store = apiStore();
        // Different nowMs each call must NOT change the ETag (only data does).
        $o1 = apiOpts();
        $o2 = apiOpts();
        $o2['nowMs'] = $o1['nowMs'] + 42_000;
        $a = Api::handle($store, '/api/v1/LSZH/movements', [], $o1);
        $b = Api::handle($store, '/api/v1/LSZH/movements', [], $o2);
        Assert::same($a['headers']['ETag'], $b['headers']['ETag'], 'etag stable across wall-clock');
    },

    'movements: dow param filters by local weekday' => function (): void {
        // apiStore seeds both movements on 2026-07-17, a Friday (dow 5).
        $fri = Api::handle(apiStore(), '/api/v1/LSZH/movements', ['dow' => '5'], apiOpts());
        $fbody = json_decode($fri['body'], true);
        Assert::same(5, $fbody['dow'], 'echoes the weekday filter');
        Assert::same(1, $fbody['totals']['landings'], 'Friday landing kept');
        Assert::same(1, $fbody['totals']['takeoffs'], 'Friday takeoff kept');

        // A different weekday filters everything out.
        $mon = Api::handle(apiStore(), '/api/v1/LSZH/movements', ['dow' => '1'], apiOpts());
        $mbody = json_decode($mon['body'], true);
        Assert::same(0, $mbody['totals']['landings'] + $mbody['totals']['takeoffs'], 'no Monday movements');

        // No dow → unfiltered; the response echoes null.
        $all = Api::handle(apiStore(), '/api/v1/LSZH/movements', [], apiOpts());
        Assert::true(json_decode($all['body'], true)['dow'] === null, 'dow null when absent');
    },

    'movements: date param restricts to one local day and is echoed' => function (): void {
        $store = apiStore(); // seeds two movements on 2026-07-17
        $opts = apiOpts();
        // A different day → nothing; the seeded day → the movements; echoed either way.
        $other = Api::handle($store, '/api/v1/LSZH/movements', ['date' => '2026-07-16'], $opts);
        $ob = json_decode($other['body'], true);
        Assert::same('2026-07-16', $ob['date'], 'echoes the date filter');
        Assert::same(0, $ob['totals']['landings'] + $ob['totals']['takeoffs'], 'no movements that day');

        $day = Api::handle($store, '/api/v1/LSZH/movements', ['date' => '2026-07-17'], $opts);
        $db = json_decode($day['body'], true);
        Assert::same(1, $db['totals']['landings'], 'seeded landing on that day');
        Assert::same(1, $db['totals']['takeoffs'], 'seeded takeoff on that day');
    },

    'movements: malformed date is ignored (null)' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/movements', ['date' => 'not-a-date'], apiOpts());
        Assert::true(json_decode($r['body'], true)['date'] === null, 'bad date → null (windowed)');
    },

    'recent: per-end movements in the window, busiest first' => function (): void {
        $store = apiStore();
        $opts = apiOpts();
        $now = $opts['nowMs'];
        $store->insertMovements('LSZH', [
            ['kind' => 'landing', 'hex' => 'x', 'end' => '28', 'ts' => $now - 10 * 60_000],
            ['kind' => 'takeoff', 'hex' => 'y', 'end' => '28', 'ts' => $now - 20 * 60_000],
            ['kind' => 'landing', 'hex' => 'z', 'end' => '16', 'ts' => $now - 5 * 60_000],
        ], 'Europe/Zurich');
        $r = Api::handle($store, '/api/v1/LSZH/recent', ['minutes' => '90'], $opts);
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::same(90, $body['minutes'], 'echoes the window');
        Assert::same('28', $body['ends'][0]['end'], 'busiest end first');
        Assert::same(2, $body['ends'][0]['movements'], '28 has 2 recent');
    },

    'recent: minutes clamped to [5, 360]' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/recent', ['minutes' => '99999'], apiOpts());
        Assert::same(360, json_decode($r['body'], true)['minutes'], 'clamped to 360');
        $r2 = Api::handle(apiStore(), '/api/v1/LSZH/recent', ['minutes' => '1'], apiOpts());
        Assert::same(5, json_decode($r2['body'], true)['minutes'], 'clamped to 5');
    },

    'recent: unknown airport 404' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/EGLL/recent', [], apiOpts());
        Assert::same(404, $r['status']);
    },

    'weather: returns hourly rows within the window' => function (): void {
        $store = apiStore();
        $opts = apiOpts();
        $now = $opts['nowMs'];
        $store->upsertWeather('LSZH', [
            ['tsMs' => $now - 2 * 3_600_000, 'windDir' => 240, 'windKt' => 10.0, 'gustKt' => 16.0,
             'tempC' => 22.0, 'precipMm' => 0.0, 'visibilityM' => 24000.0, 'cloudPct' => 20.0, 'pressureHpa' => 1017.0],
            ['tsMs' => $now + 3 * 3_600_000, 'windDir' => 260, 'windKt' => 14.0, 'gustKt' => 22.0,
             'tempC' => 20.0, 'precipMm' => 0.1, 'visibilityM' => 18000.0, 'cloudPct' => 60.0, 'pressureHpa' => 1015.0],
        ], 'Europe/Zurich', $now);

        $r = Api::handle($store, '/api/v1/LSZH/weather', [], $opts);
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::same('LSZH', $body['icao']);
        Assert::count(2, $body['hours'], 'observed + forecast hour');
        Assert::same(240, $body['hours'][0]['windDir'], 'first hour wind dir');
        Assert::true(isset($r['headers']['ETag']), 'weather is cacheable');
    },

    'weather: etag stable across wall-clock (data-only fingerprint)' => function (): void {
        $store = apiStore();
        $o1 = apiOpts();
        $o2 = apiOpts();
        $o2['nowMs'] = $o1['nowMs'] + 42_000;
        $store->upsertWeather('LSZH', [
            ['tsMs' => $o1['nowMs'], 'windDir' => 200, 'windKt' => 8.0, 'gustKt' => null, 'tempC' => null,
             'precipMm' => null, 'visibilityM' => null, 'cloudPct' => null, 'pressureHpa' => null],
        ], 'Europe/Zurich', $o1['nowMs']);
        $a = Api::handle($store, '/api/v1/LSZH/weather', [], $o1);
        $b = Api::handle($store, '/api/v1/LSZH/weather', [], $o2);
        Assert::same($a['headers']['ETag'], $b['headers']['ETag'], 'etag stable');
    },

    'weather: unknown airport -> 404' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/EGLL/weather', [], apiOpts());
        Assert::same(404, $r['status']);
    },

    'etag is a weak validator (body has generatedAt not in the seed)' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/movements', [], apiOpts());
        Assert::true(str_starts_with($r['headers']['ETag'] ?? '', 'W/"'), 'weak ETag');
    },

    'db-missing: /health answers (degraded), data endpoints return empty' => function (): void {
        // Cold start: no DB yet. The API must not 500 — /health is how you diagnose it.
        $h = Api::handle(null, '/api/v1/health', [], apiOpts());
        Assert::same(200, $h['status'], 'health up');
        $hb = json_decode($h['body'], true);
        Assert::true($hb['ok'] === true, 'ok');
        Assert::true($hb['db'] === false, 'db:false signals not-provisioned');
        Assert::same(0, $hb['polls10m'], 'no polls');

        $m = Api::handle(null, '/api/v1/LSZH/movements', [], apiOpts());
        Assert::same(200, $m['status'], 'movements empty, not 500');
        Assert::count(0, json_decode($m['body'], true)['ends'], 'empty ends');

        $w = Api::handle(null, '/api/v1/LSZH/weather', [], apiOpts());
        Assert::same(200, $w['status'], 'weather empty, not 500');
        Assert::count(0, json_decode($w['body'], true)['hours'], 'empty hours');
    },

    'summary: returns headline stats' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/summary', [], apiOpts());
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::same(1, $body['landings']);
        Assert::same(1, $body['takeoffs']);
    },

    'icao is case-insensitive' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/lszh/summary', [], apiOpts());
        Assert::same(200, $r['status']);
        Assert::same('LSZH', json_decode($r['body'], true)['icao']);
    },

    'mount-agnostic: works under the /airports-api base path' => function (): void {
        $store = apiStore();
        $h = Api::handle($store, '/airports-api/LSZH/movements', [], apiOpts());
        Assert::same(200, $h['status'], 'movements under /airports-api');
        Assert::same('LSZH', json_decode($h['body'], true)['icao']);

        $s = Api::handle($store, '/airports-api/LSZH/summary', [], apiOpts());
        Assert::same(200, $s['status'], 'summary under /airports-api');

        $health = Api::handle($store, '/airports-api/health', [], apiOpts());
        Assert::same(200, $health['status'], 'health under /airports-api');
    },

    'unknown airport: 404' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/EGLL/summary', [], apiOpts());
        Assert::same(404, $r['status']);
    },

    'unknown route: 404' => function (): void {
        $r = Api::handle(apiStore(), '/api/v1/LSZH/nonsense', [], apiOpts());
        Assert::same(404, $r['status']);
    },

    'days param is clamped to the retention window' => function (): void {
        // days=9999 must not widen beyond maxWindowDays; still returns the data.
        $r = Api::handle(apiStore(), '/api/v1/LSZH/movements', ['days' => '9999'], apiOpts());
        Assert::same(200, $r['status']);
        $body = json_decode($r['body'], true);
        Assert::same(60, $body['windowDays'], 'clamped to 60');
    },
];
