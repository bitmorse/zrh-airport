<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Read-only REST router. Pure function of the request so it's fully testable
 * without a web server: public/index.php wires the real request into handle()
 * and emits the returned status/headers/body.
 *
 * Routes (all under /api/v1):
 *   GET /health                 → liveness
 *   GET /{icao}/movements[?days]→ per-runway-end histogram
 *   GET /{icao}/summary[?days]  → headline stats
 *
 * The window is measured in whole days back from opts['nowMs'] and clamped to
 * the retention window; responses are public, cacheable, and ETagged (the
 * data only changes once a minute).
 */
final class Api
{
    private const DAY_MS = 86_400_000;

    /**
     * @param array{airports:array<int,string>,nowMs:int,defaultWindowDays:int,maxWindowDays:int} $opts
     * @return array{status:int,headers:array<string,string>,body:string}
     */
    public static function handle(Store $store, string $path, array $query, array $opts): array
    {
        $segments = self::segments($path);
        if ($segments === null) {
            return self::json(404, ['error' => 'not found']);
        }

        // /api/v1/health
        if (count($segments) === 1 && $segments[0] === 'health') {
            return self::json(200, ['ok' => true]);
        }

        if (count($segments) !== 2) {
            return self::json(404, ['error' => 'not found']);
        }

        [$rawIcao, $resource] = $segments;
        $icao = strtoupper($rawIcao);
        if (!in_array($icao, $opts['airports'], true)) {
            return self::json(404, ['error' => 'unknown airport']);
        }

        $windowDays = self::windowDays($query, $opts);
        $sinceMs = (int) $opts['nowMs'] - $windowDays * self::DAY_MS;

        switch ($resource) {
            case 'movements':
                $data = $store->histogram($icao, $sinceMs);
                $data['windowDays'] = $windowDays;
                // ETag fingerprints the data only (not the wall clock), so an
                // unchanged dataset keeps returning the same tag → cheap 304s.
                $seed = $data;
                unset($seed['sinceMs']); // derived from nowMs — would perturb the tag
                $data['generatedAt'] = (int) $opts['nowMs'];
                return self::json(200, $data, $seed);

            case 'summary':
                $data = $store->summary($icao, $sinceMs);
                $data['windowDays'] = $windowDays;
                $seed = $data;
                $data['generatedAt'] = (int) $opts['nowMs'];
                return self::json(200, $data, $seed);

            default:
                return self::json(404, ['error' => 'not found']);
        }
    }

    /** Path segments after `/api/v1/`, or null if the prefix is absent. */
    private static function segments(string $path): ?array
    {
        $path = parse_url($path, PHP_URL_PATH) ?? $path;
        $marker = '/api/v1/';
        $pos = strpos($path, $marker);
        if ($pos === false) {
            // Allow the API to be mounted at the doc root without the prefix too.
            $marker2 = '/api/v1';
            if (rtrim($path, '/') === rtrim($marker2, '/')) {
                return [];
            }
            return null;
        }
        $rest = substr($path, $pos + strlen($marker));
        $rest = trim($rest, '/');
        if ($rest === '') {
            return [];
        }
        return array_values(array_filter(explode('/', $rest), static fn ($s) => $s !== ''));
    }

    private static function windowDays(array $query, array $opts): int
    {
        $default = (int) ($opts['defaultWindowDays'] ?? 60);
        $max = (int) ($opts['maxWindowDays'] ?? 60);
        $days = isset($query['days']) && is_numeric($query['days']) ? (int) $query['days'] : $default;
        return max(1, min($max, $days));
    }

    /**
     * @param array|null $etagSeed data to fingerprint for the ETag instead of the
     *                             body (so volatile fields like generatedAt don't
     *                             perturb the tag); defaults to the body.
     * @return array{status:int,headers:array<string,string>,body:string}
     */
    private static function json(int $status, array $data, ?array $etagSeed = null): array
    {
        $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($body === false) {
            $body = '{"error":"encoding failed"}';
            $status = 500;
        }
        $seed = $etagSeed === null ? $body : (json_encode($etagSeed, JSON_UNESCAPED_SLASHES) ?: $body);
        return [
            'status' => $status,
            'headers' => [
                'Content-Type' => 'application/json; charset=utf-8',
                'Cache-Control' => 'public, max-age=300',
                'ETag' => '"' . substr(hash('sha256', $seed), 0, 16) . '"',
                'Access-Control-Allow-Origin' => '*',
            ],
            'body' => $body,
        ];
    }
}
