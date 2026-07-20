<?php

declare(strict_types=1);

/**
 * Runtime configuration. Override paths with environment variables so the same
 * code runs locally and on NearlyFreeSpeech without edits:
 *   ZRH_DB           — SQLite file path (keep OUTSIDE the web docroot on NFS)
 *   ZRH_BACKEND_ROOT — backend/ directory (used by public/index.php)
 *   ZRH_HEALTHCHECK_URL — optional healthchecks.io ping URL for the collector
 */

return [
    // Default DB lives in backend/data. On NFS, set ZRH_DB to a /home/private path.
    'db' => getenv('ZRH_DB') ?: __DIR__ . '/../data/stats.db',
    'airports' => __DIR__ . '/airports.json',
    // Query radius (nm) around the ARP — matches the frontend default.
    'radiusNm' => 25.0,
    'retentionDays' => 60,
    'defaultWindowDays' => 60,
    'maxWindowDays' => 60,
];
