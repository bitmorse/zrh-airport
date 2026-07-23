<?php

declare(strict_types=1);

namespace Zrh;

/**
 * On-request FlightAware AeroAPI proxy — the paid, opt-in complement to the live
 * ADS-B feed, used when the frontend searches for a flight that isn't (or isn't
 * yet) on the local radar: a jet still parked at the gate, or one just outside our
 * query radius. The browser calls OUR backend so the AeroAPI key never leaves the
 * server.
 *
 * Two routes, mounted at any base path (…/airports-api, /api, doc root):
 *   GET …/flight/{ident}            → resolve a designator (callsign/flight no.) to
 *                                     status, gate, terminal, scheduled/estimated
 *                                     times, route, delays + the fa_flight_id.
 *   GET …/flight/{faFlightId}/position → last known position (lat/lon/heading/…)
 *                                     for that flight, to pin it on the map.
 *
 * Cost is real (AeroAPI bills per query), so every call is (a) explicit — the UI
 * only hits this on a user action; (b) served from a short-TTL file cache so
 * re-opening the same flight is free; and (c) behind a per-day call fuse. The
 * handler is a pure function of (path, query, opts) with an injectable `httpGet`
 * and cache dir, so it is fully testable offline (see FlightInfoTest).
 */
final class FlightInfo
{
    private const TIMEOUT_S = 8;

    /** True when the path is one of our /flight routes (so index.php can dispatch). */
    public static function matches(string $path): bool
    {
        return self::route($path) !== null;
    }

    /**
     * @param array{apiKey:?string,base:string,nowMs:int,cacheDir:string,infoTtlMs:int,posTtlMs:int,dailyCap:int,httpGet?:callable} $opts
     * @return array{status:int,headers:array<string,string>,body:string}
     */
    public static function handle(string $path, array $query, array $opts): array
    {
        $route = self::route($path);
        if ($route === null) {
            return self::json(404, ['error' => 'not found'], false);
        }
        [$kind, $rawId] = $route;
        $now = (int) $opts['nowMs'];
        $apiKey = $opts['apiKey'] ?? null;
        if ($apiKey === null || $apiKey === '') {
            // Deployed without a key configured — say so plainly, don't 500.
            return self::json(501, ['error' => 'flight lookup not configured'], false);
        }
        $base = (string) $opts['base'];

        if ($kind === 'info') {
            $ident = strtoupper($rawId);
            if (!preg_match('/^[A-Z0-9]{2,12}$/', $ident)) {
                return self::json(400, ['error' => 'invalid ident'], false);
            }
            return self::serve('info:' . $ident, (int) $opts['infoTtlMs'], $opts, $now,
                fn (callable $httpGet): array => self::fetchInfo($base, (string) $apiKey, $ident, $now, $httpGet));
        }

        // position: {id} is an fa_flight_id (hyphenated), from a prior info call.
        $id = $rawId;
        if (!preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $id)) {
            return self::json(400, ['error' => 'invalid id'], false);
        }
        return self::serve('pos:' . $id, (int) $opts['posTtlMs'], $opts, $now,
            fn (callable $httpGet): array => self::fetchPosition($base, (string) $apiKey, $id, $httpGet));
    }

    /**
     * Cache-first, cost-capped fetch. Returns a fresh cache hit for free; otherwise,
     * if under the daily fuse, calls the provider and caches the result; if over the
     * fuse, serves a stale copy when one exists or 429s.
     *
     * @param callable(callable):array{status:int,data:?array} $producer
     */
    private static function serve(string $key, int $ttlMs, array $opts, int $now, callable $producer): array
    {
        $dir = (string) $opts['cacheDir'];

        $fresh = self::cacheGet($dir, $key, $now, $ttlMs);
        if ($fresh !== null) {
            return self::json(200, ['cached' => true, 'generatedAt' => $now] + $fresh);
        }

        $cap = (int) ($opts['dailyCap'] ?? 0);
        if ($cap > 0 && self::dailyCount($dir, $now) >= $cap) {
            // Prefer a stale-but-real answer over a hard failure at the billing ceiling.
            $stale = self::cacheGet($dir, $key, $now, PHP_INT_MAX);
            if ($stale !== null) {
                return self::json(200, ['cached' => true, 'stale' => true, 'generatedAt' => $now] + $stale);
            }
            return self::json(429, ['error' => 'daily flight-lookup limit reached'], false);
        }

        $httpGet = $opts['httpGet'] ?? [self::class, 'curlGet'];
        self::bumpCount($dir, $now); // count the attempt — a call is billed whether or not it 200s
        try {
            $result = $producer($httpGet);
        } catch (\Throwable $e) {
            return self::json(502, ['error' => 'flight provider unavailable'], false);
        }

        $status = (int) $result['status'];
        if ($status === 404) {
            return self::json(404, ['error' => 'flight not found'], false);
        }
        if ($status === 401 || $status === 403) {
            return self::json(502, ['error' => 'flight provider auth error'], false);
        }
        if ($status < 200 || $status >= 300 || !is_array($result['data'])) {
            return self::json(502, ['error' => 'flight provider error'], false);
        }

        $data = $result['data'];
        self::cachePut($dir, $key, $data, $now);
        return self::json(200, ['cached' => false, 'generatedAt' => $now] + $data);
    }

    /** GET /flights/{ident} → compact info for the leg most relevant to `now`. */
    private static function fetchInfo(string $base, string $apiKey, string $ident, int $now, callable $httpGet): array
    {
        $url = rtrim($base, '/') . '/flights/' . rawurlencode($ident) . '?ident_type=designator&max_pages=1';
        $resp = $httpGet($url, ['x-apikey: ' . $apiKey, 'Accept: application/json'], self::TIMEOUT_S);
        $status = (int) ($resp['status'] ?? 0);
        if ($status < 200 || $status >= 300) {
            return ['status' => $status, 'data' => null];
        }
        $json = json_decode((string) ($resp['body'] ?? ''), true);
        $flights = is_array($json) && isset($json['flights']) && is_array($json['flights']) ? $json['flights'] : [];
        if ($flights === []) {
            return ['status' => 404, 'data' => null];
        }
        return ['status' => 200, 'data' => self::mapInfo(self::pickRelevant($flights, $now))];
    }

    /** GET /flights/{id}/position → last known position (may be null if none). */
    private static function fetchPosition(string $base, string $apiKey, string $id, callable $httpGet): array
    {
        $url = rtrim($base, '/') . '/flights/' . rawurlencode($id) . '/position';
        $resp = $httpGet($url, ['x-apikey: ' . $apiKey, 'Accept: application/json'], self::TIMEOUT_S);
        $status = (int) ($resp['status'] ?? 0);
        if ($status < 200 || $status >= 300) {
            return ['status' => $status, 'data' => null];
        }
        $json = json_decode((string) ($resp['body'] ?? ''), true);
        if (!is_array($json)) {
            return ['status' => 502, 'data' => null];
        }
        return ['status' => 200, 'data' => self::mapPosition($json)];
    }

    /**
     * The info endpoint returns ~14 days of recent + scheduled legs (scheduled_out
     * desc). Pick the one that best matches "now": an in-progress flight (off the
     * ground, not yet on) wins; otherwise the leg whose scheduled time is nearest to
     * now; cancelled legs are de-prioritised.
     */
    private static function pickRelevant(array $flights, int $now): array
    {
        $best = null;
        $bestScore = null;
        foreach ($flights as $f) {
            if (!is_array($f)) {
                continue;
            }
            $active = !empty($f['actual_off']) && empty($f['actual_on']);
            $t = self::ms($f['scheduled_out'] ?? $f['scheduled_off'] ?? $f['estimated_out'] ?? $f['estimated_off'] ?? null);
            $dist = $t === null ? PHP_INT_MAX : abs($now - $t);
            $score = ($active ? 0 : 1) * PHP_INT_MAX / 4 + $dist / 4;
            if (!empty($f['cancelled'])) {
                $score += PHP_INT_MAX / 4;
            }
            if ($bestScore === null || $score < $bestScore) {
                $bestScore = $score;
                $best = $f;
            }
        }
        return is_array($best) ? $best : $flights[0];
    }

    /** Shape one AeroAPI flight into the compact record the frontend consumes. */
    private static function mapInfo(array $f): array
    {
        return [
            'faFlightId' => self::s($f, 'fa_flight_id'),
            'ident' => self::s($f, 'ident'),
            'identIcao' => self::s($f, 'ident_icao'),
            'identIata' => self::s($f, 'ident_iata'),
            'registration' => self::s($f, 'registration'),
            'aircraftType' => self::s($f, 'aircraft_type'),
            'operator' => self::s($f, 'operator'),
            'operatorIcao' => self::s($f, 'operator_icao'),
            'flightNumber' => self::s($f, 'flight_number'),
            'status' => self::s($f, 'status'),
            'progressPercent' => self::i($f, 'progress_percent'),
            'cancelled' => (bool) ($f['cancelled'] ?? false),
            'diverted' => (bool) ($f['diverted'] ?? false),
            'positionOnly' => (bool) ($f['position_only'] ?? false),
            'origin' => self::endpoint($f['origin'] ?? null),
            'destination' => self::endpoint($f['destination'] ?? null),
            'gateOrigin' => self::s($f, 'gate_origin'),
            'gateDestination' => self::s($f, 'gate_destination'),
            'terminalOrigin' => self::s($f, 'terminal_origin'),
            'terminalDestination' => self::s($f, 'terminal_destination'),
            'baggageClaim' => self::s($f, 'baggage_claim'),
            'scheduledOut' => self::s($f, 'scheduled_out'),
            'estimatedOut' => self::s($f, 'estimated_out'),
            'actualOut' => self::s($f, 'actual_out'),
            'scheduledOff' => self::s($f, 'scheduled_off'),
            'estimatedOff' => self::s($f, 'estimated_off'),
            'actualOff' => self::s($f, 'actual_off'),
            'scheduledOn' => self::s($f, 'scheduled_on'),
            'estimatedOn' => self::s($f, 'estimated_on'),
            'actualOn' => self::s($f, 'actual_on'),
            'scheduledIn' => self::s($f, 'scheduled_in'),
            'estimatedIn' => self::s($f, 'estimated_in'),
            'actualIn' => self::s($f, 'actual_in'),
            'departureDelay' => self::i($f, 'departure_delay'),
            'arrivalDelay' => self::i($f, 'arrival_delay'),
            'route' => self::s($f, 'route'),
            'routeDistance' => self::i($f, 'route_distance'),
            'filedAltitude' => self::i($f, 'filed_altitude'),
            'filedAirspeed' => self::i($f, 'filed_airspeed'),
        ];
    }

    /** Shape a /position response; position fields are null when none is on file. */
    private static function mapPosition(array $json): array
    {
        $lp = is_array($json['last_position'] ?? null) ? $json['last_position'] : [];
        return [
            'faFlightId' => self::s($json, 'fa_flight_id'),
            'ident' => self::s($json, 'ident'),
            'aircraftType' => self::s($json, 'aircraft_type'),
            'origin' => self::endpoint($json['origin'] ?? null),
            'destination' => self::endpoint($json['destination'] ?? null),
            'lat' => self::f($lp, 'latitude'),
            'lon' => self::f($lp, 'longitude'),
            'heading' => self::i($lp, 'heading'),
            'altitude' => self::i($lp, 'altitude'),
            'altitudeChange' => self::s($lp, 'altitude_change'),
            'groundspeed' => self::i($lp, 'groundspeed'),
            'updateType' => self::s($lp, 'update_type'),
            'timestamp' => self::s($lp, 'timestamp'),
        ];
    }

    /** Compact airport reference {icao, iata, name, city} or null. */
    private static function endpoint(mixed $o): ?array
    {
        if (!is_array($o)) {
            return null;
        }
        return [
            'icao' => self::s($o, 'code_icao'),
            'iata' => self::s($o, 'code_iata'),
            'name' => self::s($o, 'name'),
            'city' => self::s($o, 'city'),
        ];
    }

    private static function s(array $a, string $k): ?string
    {
        $v = $a[$k] ?? null;
        return (is_string($v) && $v !== '') ? $v : null;
    }

    private static function i(array $a, string $k): ?int
    {
        $v = $a[$k] ?? null;
        return is_numeric($v) ? (int) $v : null;
    }

    private static function f(array $a, string $k): ?float
    {
        $v = $a[$k] ?? null;
        return is_numeric($v) ? (float) $v : null;
    }

    /** ISO8601 → epoch ms, or null. */
    private static function ms(?string $iso): ?int
    {
        if (!is_string($iso) || $iso === '') {
            return null;
        }
        try {
            return (new \DateTimeImmutable($iso))->getTimestamp() * 1000;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Resolve trailing segments to a route, ignoring the mount prefix:
     *   [...,'flight',{ident}]              → ['info', ident]
     *   [...,'flight',{id},'position']      → ['position', id]
     */
    private static function route(string $path): ?array
    {
        $path = parse_url($path, PHP_URL_PATH) ?? $path;
        $parts = array_values(array_filter(explode('/', $path), static fn ($s) => $s !== ''));
        $n = count($parts);
        if ($n >= 3 && strtolower($parts[$n - 1]) === 'position' && strtolower($parts[$n - 3]) === 'flight') {
            return ['position', rawurldecode($parts[$n - 2])];
        }
        if ($n >= 2 && strtolower($parts[$n - 2]) === 'flight') {
            return ['info', rawurldecode($parts[$n - 1])];
        }
        return null;
    }

    private static function json(int $status, array $data, bool $cacheable = true, int $maxAge = 120): array
    {
        $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($body === false) {
            $body = '{"error":"encoding failed"}';
            $status = 500;
        }
        $headers = [
            'Content-Type' => 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin' => '*',
            'Cache-Control' => $cacheable ? 'public, max-age=' . $maxAge : 'no-store',
        ];
        return ['status' => $status, 'headers' => $headers, 'body' => $body];
    }

    // --- File cache + daily call counter (best-effort; needs a web-writable dir) ---

    private static function cachePath(string $dir, string $key): string
    {
        return rtrim($dir, '/') . '/fi_' . sha1($key) . '.json';
    }

    private static function cacheGet(string $dir, string $key, int $now, int $ttlMs): ?array
    {
        if ($dir === '') {
            return null;
        }
        $raw = @file_get_contents(self::cachePath($dir, $key));
        if ($raw === false) {
            return null;
        }
        $j = json_decode($raw, true);
        if (!is_array($j) || !isset($j['t'], $j['d']) || !is_array($j['d'])) {
            return null;
        }
        return ($now - (int) $j['t'] > $ttlMs) ? null : $j['d'];
    }

    private static function cachePut(string $dir, string $key, array $data, int $now): void
    {
        if ($dir === '') {
            return;
        }
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        @file_put_contents(
            self::cachePath($dir, $key),
            (string) json_encode(['t' => $now, 'd' => $data], JSON_UNESCAPED_SLASHES),
            LOCK_EX
        );
    }

    private static function countPath(string $dir, int $now): string
    {
        return rtrim($dir, '/') . '/calls_' . gmdate('Ymd', intdiv($now, 1000)) . '.txt';
    }

    private static function dailyCount(string $dir, int $now): int
    {
        if ($dir === '') {
            return 0;
        }
        $raw = @file_get_contents(self::countPath($dir, $now));
        return $raw === false ? 0 : (int) trim($raw);
    }

    private static function bumpCount(string $dir, int $now): void
    {
        if ($dir === '') {
            return;
        }
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $fh = @fopen(self::countPath($dir, $now), 'c+');
        if ($fh === false) {
            return;
        }
        @flock($fh, LOCK_EX);
        $cur = (int) trim((string) stream_get_contents($fh));
        rewind($fh);
        ftruncate($fh, 0);
        fwrite($fh, (string) ($cur + 1));
        fflush($fh);
        @flock($fh, LOCK_UN);
        fclose($fh);
    }

    /** Default transport: returns {status, body} and never throws on HTTP status. */
    public static function curlGet(string $url, array $headers, int $timeoutS): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeoutS,
            CURLOPT_CONNECTTIMEOUT => $timeoutS,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'zrh-airport-stats/1.0 (+https://bitmorse.com)',
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => is_string($body) ? $body : null];
    }
}
