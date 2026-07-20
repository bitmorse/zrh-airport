<?php

declare(strict_types=1);

/**
 * Runtime configuration. Override paths with environment variables so the same
 * code runs locally and on NearlyFreeSpeech without edits:
 *   ZRH_DB           — SQLite file path (keep OUTSIDE the web docroot on NFS)
 *   ZRH_BACKEND_ROOT — backend/ directory (used by airports-api/index.php)
 *   ZRH_HEALTHCHECK_URL — optional healthchecks.io ping URL for the collector
 *
 * Values may come from the real environment (cron) or Apache `SetEnv` (web),
 * so we check both getenv() and $_SERVER.
 */

$env = static fn (string $k): string => getenv($k) ?: (string) ($_SERVER[$k] ?? '');

return [
    // Default DB lives in backend/data. On NFS, set ZRH_DB to a /home/private path.
    'db' => $env('ZRH_DB') ?: __DIR__ . '/../data/stats.db',
    'airports' => __DIR__ . '/airports.json',
    // Query radius (nm) around the ARP — matches the frontend default.
    'radiusNm' => 25.0,
    'retentionDays' => 60,
    'defaultWindowDays' => 60,
    'maxWindowDays' => 60,
    // Weather is hourly, so fetch it on a throttle rather than every poll.
    'weatherEverySeconds' => 900,   // 15 min
    'weatherRetentionDays' => 365,  // keep a year of hourly weather (tiny; for training)
    // How many past days each fetch requests (Open-Meteo allows up to 92). >1 lets
    // a restart/outage backfill the gap instead of leaving a permanent hole.
    'weatherPastDays' => 7,
];
