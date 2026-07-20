<?php

declare(strict_types=1);

/**
 * Web entry point for the read-only stats API. This folder is meant to be the
 * web-facing one (e.g. mounted at bitmorse.com/airports-api). The backend root
 * that holds src/, config/ and data/ is located by, in order:
 *   1. the ZRH_BACKEND_ROOT env / SetEnv value, if it points at a src/bootstrap.php;
 *   2. walking up from this file until a src/bootstrap.php is found.
 * All routing lives in Zrh\Api::handle (see src/Api.php).
 */

$root = zrh_backend_root(__DIR__);
require $root . '/src/bootstrap.php';

function zrh_backend_root(string $start): string
{
    $env = getenv('ZRH_BACKEND_ROOT') ?: (string) ($_SERVER['ZRH_BACKEND_ROOT'] ?? '');
    if ($env !== '' && is_file($env . '/src/bootstrap.php')) {
        return $env;
    }
    $dir = $start;
    for ($i = 0; $i < 6; $i++) {
        if (is_file($dir . '/src/bootstrap.php')) {
            return $dir;
        }
        $dir = dirname($dir);
    }
    http_response_code(500);
    header('Content-Type: application/json');
    echo '{"error":"backend root not found — set ZRH_BACKEND_ROOT to the backend/ directory"}';
    exit;
}

use Zrh\Api;
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

$airports = array_keys(json_decode((string) file_get_contents($cfg['airports']), true) ?: []);

try {
    $store = Store::open($cfg['db']);
    $res = Api::handle($store, $_SERVER['REQUEST_URI'] ?? '/', $_GET, [
        'airports' => $airports,
        'nowMs' => (int) (microtime(true) * 1000),
        'defaultWindowDays' => (int) $cfg['defaultWindowDays'],
        'maxWindowDays' => (int) $cfg['maxWindowDays'],
    ]);
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
