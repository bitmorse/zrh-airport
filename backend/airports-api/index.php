<?php

declare(strict_types=1);

/**
 * Web entry point for the read-only stats API. This folder is meant to be the
 * web-facing one (e.g. mounted at bitmorse.com/airports-api). The backend root
 * that holds src/, config/ and data/ is located by trying, in order:
 *   1. the ZRH_BACKEND_ROOT env / Apache SetEnv value;
 *   2. walking up from this file (works if the code sits alongside index.php);
 *   3. the standard NFS locations below — a safety net so the API keeps working
 *      even if the SetEnv line is ever dropped from .htaccess.
 * All routing lives in Zrh\Api::handle (see src/Api.php).
 */

$root = zrh_backend_root(__DIR__);
require $root . '/src/bootstrap.php';

function zrh_backend_root(string $start): string
{
    $candidates = [];
    $env = getenv('ZRH_BACKEND_ROOT') ?: (string) ($_SERVER['ZRH_BACKEND_ROOT'] ?? '');
    if ($env !== '') {
        $candidates[] = $env;
    }
    $dir = $start;
    for ($i = 0; $i < 6; $i++) {
        $candidates[] = $dir;
        $dir = dirname($dir);
    }
    // Known NFS layout: code kept outside the web docroot.
    $candidates[] = '/home/protected/backend';
    $candidates[] = '/home/private/backend';

    foreach ($candidates as $c) {
        if ($c !== '' && is_file($c . '/src/bootstrap.php')) {
            return $c;
        }
    }

    http_response_code(500);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo '{"error":"backend root not found — set ZRH_BACKEND_ROOT to the backend/ directory"}';
    exit;
}

use Zrh\Api;
use Zrh\FlightInfo;
use Zrh\Store;

$cfg = require $root . '/config/app.php';

// Only GET/HEAD are supported; the API is read-only.
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD, OPTIONS');
    exit;
}
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
    http_response_code(204);
    exit;
}

$reqUri = $_SERVER['REQUEST_URI'] ?? '/';

try {
    if (FlightInfo::matches($reqUri)) {
        // On-request AeroAPI proxy: no DB or airport allowlist needed; it does its
        // own network fetch (server-side key), caching and daily cost fuse.
        $res = FlightInfo::handle($reqUri, $_GET, [
            'apiKey' => $cfg['aeroApiKey'],
            'base' => (string) $cfg['aeroApiBase'],
            'nowMs' => (int) (microtime(true) * 1000),
            'cacheDir' => (string) $cfg['flightCacheDir'],
            'infoTtlMs' => (int) $cfg['flightInfoTtlSeconds'] * 1000,
            'posTtlMs' => (int) $cfg['flightPositionTtlSeconds'] * 1000,
            'dailyCap' => (int) $cfg['flightDailyCap'],
        ]);
    } else {
        // Airport allowlist. A missing/malformed config is a deployment error, not a
        // per-request one — fail clearly rather than degrading every airport to "unknown".
        $airportsRaw = @file_get_contents($cfg['airports']);
        $airportsCfg = is_string($airportsRaw) ? json_decode($airportsRaw, true) : null;
        if (!is_array($airportsCfg) || $airportsCfg === []) {
            throw new \RuntimeException('airport config unavailable');
        }
        // Read-only: the API only ever SELECTs, and the web user usually can't write
        // the DB. The collector (running as the file owner) creates and writes it.
        // A missing DB (collector hasn't run yet) is degraded-but-up, not a 500:
        // pass a null store so /health can report it and data endpoints return empty.
        $store = is_file($cfg['db']) ? Store::openReader($cfg['db']) : null;
        $res = Api::handle($store, $reqUri, $_GET, [
            'airports' => array_keys($airportsCfg),
            'nowMs' => (int) (microtime(true) * 1000),
            'defaultWindowDays' => (int) $cfg['defaultWindowDays'],
            'maxWindowDays' => (int) $cfg['maxWindowDays'],
        ]);
    }
} catch (\Throwable $e) {
    $res = [
        'status' => 500,
        'headers' => ['Content-Type' => 'application/json; charset=utf-8', 'Access-Control-Allow-Origin' => '*'],
        'body' => json_encode(['error' => 'internal error']),
    ];
}

http_response_code($res['status']);
foreach ($res['headers'] as $name => $value) {
    header("{$name}: {$value}");
}

// Honour conditional requests so repeat opens get a cheap 304.
$etag = $res['headers']['ETag'] ?? null;
if ($etag !== null && ($_SERVER['HTTP_IF_NONE_MATCH'] ?? null) === $etag) {
    http_response_code(304);
    exit;
}

if ($method !== 'HEAD') {
    echo $res['body'];
}
