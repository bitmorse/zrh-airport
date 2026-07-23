<?php

declare(strict_types=1);

/**
 * Manual require-based autoload. No Composer on the target host, so we just pull
 * in every class here. Order doesn't matter (classes are only resolved at call
 * time), but we keep it roughly dependency-first for readability.
 */

require_once __DIR__ . '/Geo.php';
require_once __DIR__ . '/Airport.php';
require_once __DIR__ . '/Detector.php';
require_once __DIR__ . '/Adsb.php';
require_once __DIR__ . '/Weather.php';
require_once __DIR__ . '/Store.php';
require_once __DIR__ . '/Collector.php';
require_once __DIR__ . '/Api.php';
require_once __DIR__ . '/FlightInfo.php';
require_once __DIR__ . '/Cli.php';
