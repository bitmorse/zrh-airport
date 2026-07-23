<?php

declare(strict_types=1);

use Zrh\FlightInfo;

/**
 * The on-request AeroAPI proxy. Handler is a pure function of (path, query, opts)
 * with an injectable `httpGet` and a temp cache dir, so it runs fully offline.
 */

/** A fake AeroAPI transport that records calls and replays canned {status, body}. */
function fakeHttp(array &$calls, int $status, string $body): callable
{
    return function (string $url, array $headers, int $timeout) use (&$calls, $status, $body): array {
        $calls[] = $url;
        return ['status' => $status, 'body' => $body];
    };
}

function fiCacheDir(): string
{
    $dir = sys_get_temp_dir() . '/fi_test_' . bin2hex(random_bytes(6));
    mkdir($dir, 0775, true);
    return $dir;
}

function fiOpts(string $dir, callable $httpGet, array $over = []): array
{
    return array_merge([
        'apiKey' => 'test-key',
        'base' => 'https://aeroapi.example/aeroapi',
        'nowMs' => tsAt('2026-07-23 12:00:00', 'UTC'),
        'cacheDir' => $dir,
        'infoTtlMs' => 300_000,
        'posTtlMs' => 60_000,
        'dailyCap' => 500,
        'httpGet' => $httpGet,
    ], $over);
}

const FI_FLIGHT_JSON = '{"flights":[
  {"ident":"SWR72","ident_icao":"SWR72","ident_iata":"LX72","fa_flight_id":"SWR72-123-airline-0",
   "registration":"HBJHA","aircraft_type":"A333","operator":"SWR","flight_number":"72",
   "status":"Scheduled","progress_percent":0,"cancelled":false,
   "origin":{"code_icao":"LSZH","code_iata":"ZRH","name":"Zurich","city":"Zurich"},
   "destination":{"code_icao":"KJFK","code_iata":"JFK","name":"John F Kennedy Intl","city":"New York"},
   "gate_origin":"B27","terminal_origin":"1","departure_delay":600,
   "scheduled_out":"2026-07-23T12:30:00Z","estimated_out":"2026-07-23T12:40:00Z","route":"KLO SPR"}
]}';

return [
    'matches: recognises /flight routes only' => function (): void {
        Assert::true(FlightInfo::matches('/airports-api/flight/SWR72'), 'info route');
        Assert::true(FlightInfo::matches('/flight/SWR72-1-a/position'), 'position route');
        Assert::false(FlightInfo::matches('/airports-api/LSZH/movements'), 'stats route');
        Assert::false(FlightInfo::matches('/health'), 'health');
    },

    'info: not configured without a key → 501' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $r = FlightInfo::handle('/flight/SWR72', [], fiOpts($dir, fakeHttp($calls, 200, '{}'), ['apiKey' => null]));
        Assert::same(501, $r['status']);
        Assert::count(0, $calls); // never touches the provider
    },

    'info: invalid ident → 400, no call' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $r = FlightInfo::handle('/flight/AB@CD', [], fiOpts($dir, fakeHttp($calls, 200, '{}')));
        Assert::same(400, $r['status']); // routes as info, but the ident fails validation
        Assert::count(0, $calls);
    },

    'info: maps the relevant leg and echoes cached=false' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $r = FlightInfo::handle('/airports-api/flight/SWR72', [], fiOpts($dir, fakeHttp($calls, 200, FI_FLIGHT_JSON)));
        Assert::same(200, $r['status']);
        Assert::count(1, $calls);
        Assert::true(str_contains($calls[0], '/flights/SWR72?ident_type=designator'), 'designator query');
        $b = json_decode($r['body'], true);
        Assert::same('SWR72-123-airline-0', $b['faFlightId']);
        Assert::same('LX72', $b['identIata']);
        Assert::same('B27', $b['gateOrigin']);
        Assert::same(600, $b['departureDelay']);
        Assert::same('LSZH', $b['origin']['icao']);
        Assert::same('JFK', $b['destination']['iata']);
        Assert::false($b['cached']);
    },

    'info: second call within TTL is served from cache (no provider call)' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $opts = fiOpts($dir, fakeHttp($calls, 200, FI_FLIGHT_JSON));
        FlightInfo::handle('/flight/SWR72', [], $opts);
        $r2 = FlightInfo::handle('/flight/SWR72', [], $opts);
        Assert::count(1, $calls); // still just the first call
        $b = json_decode($r2['body'], true);
        Assert::true($b['cached'], 'served from cache');
        Assert::same('B27', $b['gateOrigin']);
    },

    'info: provider 404 → flight not found' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $r = FlightInfo::handle('/flight/ZZZZ9', [], fiOpts($dir, fakeHttp($calls, 404, '{"title":"Not Found"}')));
        Assert::same(404, $r['status']);
        $b = json_decode($r['body'], true);
        Assert::same('flight not found', $b['error']);
    },

    'info: provider auth error is masked as 502' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $r = FlightInfo::handle('/flight/SWR72', [], fiOpts($dir, fakeHttp($calls, 401, '{}')));
        Assert::same(502, $r['status']);
        Assert::false(str_contains($r['body'], 'test-key'), 'never leaks the key');
    },

    'position: maps last_position' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $json = '{"fa_flight_id":"SWR72-1-a","ident":"SWR72","aircraft_type":"A333",
          "last_position":{"latitude":47.46,"longitude":8.55,"heading":163,"altitude":20,"groundspeed":140,"update_type":"A","timestamp":"2026-07-23T12:00:00Z"}}';
        $r = FlightInfo::handle('/flight/SWR72-1-a/position', [], fiOpts($dir, fakeHttp($calls, 200, $json)));
        Assert::same(200, $r['status']);
        Assert::true(str_contains($calls[0], '/flights/SWR72-1-a/position'), 'position url');
        $b = json_decode($r['body'], true);
        Assert::near(47.46, $b['lat'], 1e-9);
        Assert::near(8.55, $b['lon'], 1e-9);
        Assert::same(163, $b['heading']);
    },

    'position: null last_position → position fields null, still 200' => function (): void {
        $dir = fiCacheDir();
        $calls = [];
        $json = '{"fa_flight_id":"SWR72-1-a","ident":"SWR72","last_position":null}';
        $r = FlightInfo::handle('/flight/SWR72-1-a/position', [], fiOpts($dir, fakeHttp($calls, 200, $json)));
        Assert::same(200, $r['status']);
        $b = json_decode($r['body'], true);
        Assert::same(null, $b['lat']);
        Assert::same('SWR72', $b['ident']);
    },

    'cost fuse: at the daily cap with no cache → 429' => function (): void {
        $dir = fiCacheDir();
        // Pre-seed today's counter at the cap.
        $now = tsAt('2026-07-23 12:00:00', 'UTC');
        file_put_contents($dir . '/calls_' . gmdate('Ymd', intdiv($now, 1000)) . '.txt', '500');
        $calls = [];
        $r = FlightInfo::handle('/flight/SWR72', [], fiOpts($dir, fakeHttp($calls, 200, FI_FLIGHT_JSON)));
        Assert::same(429, $r['status']);
        Assert::count(0, $calls); // fuse blocks the billed call
    },

    'cost fuse: over the cap still serves a stale cached copy' => function (): void {
        $dir = fiCacheDir();
        $calls1 = [];
        // Warm the cache first (one billed call).
        FlightInfo::handle('/flight/SWR72', [], fiOpts($dir, fakeHttp($calls1, 200, FI_FLIGHT_JSON)));
        // Now slam the counter to the cap and request again well past the TTL.
        $later = tsAt('2026-07-23 23:00:00', 'UTC');
        file_put_contents($dir . '/calls_' . gmdate('Ymd', intdiv($later, 1000)) . '.txt', '500');
        $calls2 = [];
        $r = FlightInfo::handle('/flight/SWR72', [], fiOpts($dir, fakeHttp($calls2, 200, FI_FLIGHT_JSON), ['nowMs' => $later]));
        Assert::same(200, $r['status']);
        Assert::count(0, $calls2); // no new billed call
        $b = json_decode($r['body'], true);
        Assert::true($b['cached'] && ($b['stale'] ?? false), 'served stale from cache');
    },
];
