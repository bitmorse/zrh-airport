<?php

declare(strict_types=1);

/**
 * Collector entry point.
 *
 * Single poll (default):
 *   php bin/collect.php LSZH
 *
 * Self-looping — poll every 30s for 9 minutes, then exit (recommended on NFS,
 * whose scheduled tasks fire at most every ~10 min). One cron kick every 10 min
 * running this gives continuous 30s cadence 24/7:
 *   php bin/collect.php --loop 540 --every 30 LSZH
 *
 * A non-blocking flock (held for the whole run) prevents overlapping kicks. On a
 * run with at least one successful poll it pings ZRH_HEALTHCHECK_URL, if set, as
 * a dead-man's switch. Safe to be killed mid-run: each poll commits on its own,
 * so the next kick simply resumes.
 */

require __DIR__ . '/../src/bootstrap.php';

use Zrh\Adsb;
use Zrh\Airport;
use Zrh\Cli;
use Zrh\Collector;
use Zrh\Store;

$cfg = require __DIR__ . '/../config/app.php';
$args = Cli::parseArgs($argv);

$lockPath = sys_get_temp_dir() . '/zrh-collect.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, '[' . date('c') . "] previous run still in progress — skipping\n");
    exit(0);
}

$store = Store::open($cfg['db']);

// Pre-load airport geometry once (reused across every poll in the loop).
$airports = [];
foreach ($args['icaos'] as $icao) {
    try {
        $airports[$icao] = Airport::load($icao, $cfg['airports']);
    } catch (\Throwable $e) {
        fwrite(STDERR, '[' . date('c') . "] {$icao} config error: " . $e->getMessage() . "\n");
    }
}

$deadline = microtime(true) + $args['loopSeconds'];
$polls = 0;
$totalMovements = 0;
$okPolls = 0;
$errPolls = 0;

do {
    $cycleStart = microtime(true);
    $nowMs = (int) ($cycleStart * 1000);
    $polls++;

    foreach ($airports as $icao => $airport) {
        try {
            $snapshot = null;
            $result = Collector::runCycle(
                $airport,
                $store,
                function () use ($airport, $cfg, &$snapshot) {
                    $snapshot = Adsb::fetchAircraftNear($airport->arp, (float) $cfg['radiusNm']);
                    return $snapshot['aircraft'];
                },
                $nowMs,
                (int) $cfg['retentionDays'],
            );
            $okPolls++;
            $totalMovements += $result['movements'];
            // In loop mode, stay quiet unless something actually happened.
            if ($args['loopSeconds'] === 0 || $result['movements'] > 0) {
                fwrite(STDOUT, sprintf(
                    "[%s] %s provider=%s seen=%d movements=%d tracked=%d pruned=%d\n",
                    date('c'),
                    $icao,
                    $snapshot['provider'] ?? '-',
                    count($snapshot['aircraft'] ?? []),
                    $result['movements'],
                    $result['tracked'],
                    $result['pruned'],
                ));
            }
        } catch (\Throwable $e) {
            $errPolls++;
            fwrite(STDERR, '[' . date('c') . "] {$icao} ERROR: " . $e->getMessage() . "\n");
        }
    }

    if ($args['loopSeconds'] === 0) {
        break;
    }
    // Sleep to the next interval, but never past the loop deadline.
    $next = $cycleStart + $args['everySeconds'];
    if ($next >= $deadline) {
        break;
    }
    $sleep = $next - microtime(true);
    if ($sleep > 0) {
        usleep((int) ($sleep * 1_000_000));
    }
} while (microtime(true) < $deadline);

if ($args['loopSeconds'] > 0) {
    fwrite(STDOUT, sprintf(
        "[%s] loop done: polls=%d ok=%d err=%d movements=%d\n",
        date('c'),
        $polls,
        $okPolls,
        $errPolls,
        $totalMovements,
    ));
}

// Dead-man's switch: ping only if at least one poll succeeded this run.
$hcUrl = getenv('ZRH_HEALTHCHECK_URL') ?: (string) ($_SERVER['ZRH_HEALTHCHECK_URL'] ?? '');
if ($okPolls > 0 && $hcUrl !== '') {
    $ch = curl_init($hcUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
    curl_exec($ch);
    curl_close($ch);
}

flock($lock, LOCK_UN);
fclose($lock);
exit($okPolls > 0 ? 0 : 1);
