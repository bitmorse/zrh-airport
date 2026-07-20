<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Read-only REST router. Pure function of the request so it's fully testable
 * without a web server: public/index.php wires the real request into handle()
 * and emits the returned status/headers/body.
 *
 * Routes are matched by their trailing path segments, so the API works mounted
 * at any base path — /airports-api, /api/v1, or the doc root:
 *   GET …/health                 → liveness
 *   GET …/{icao}/movements[?days] → per-runway-end histogram
 *   GET …/{icao}/summary[?days]   → headline stats
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
        $route = self::route($path);
        if ($route === null) {
            return self::json(404, ['error' => 'not found']);
        }
        if ($route === ['health']) {
            return self::json(200, ['ok' => true]);
        }

        [$rawIcao, $resource] = $route;
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

    /**
     * Resolve a request path to a route by its trailing segments, ignoring any
     * mount prefix (/airports-api, /api/v1, …):
     *   [...,'health']              → ['health']
     *   [...,'{icao}','movements']  → ['{icao}','movements']
     *   [...,'{icao}','summary']    → ['{icao}','summary']
     * Returns null when nothing matches.
     */
    private static function route(string $path): ?array
    {
        $path = parse_url($path, PHP_URL_PATH) ?? $path;
        $parts = array_values(array_filter(explode('/', $path), static fn ($s) => $s !== ''));
        $n = count($parts);
        if ($n >= 1 && strtolower($parts[$n - 1]) === 'health') {
            return ['health'];
        }
        if ($n >= 2) {
            $resource = strtolower($parts[$n - 1]);
            if ($resource === 'movements' || $resource === 'summary') {
                return [$parts[$n - 2], $resource];
            }
        }
        return null;
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
