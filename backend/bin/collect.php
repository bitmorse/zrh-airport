<?php

declare(strict_types=1);

/**
 * Collector entry point.
 *
 * Single poll (default):
 *   php bin/collect.php LSZH
 *
 * Persistent NFS daemon (recommended) — loop forever, polling every 30s across
 * every configured airport until killed; NFS restarts it if it exits:
 *   php bin/collect.php --forever --every 30 --all
 *
 * Bounded loop (scheduled-task fallback / local testing) — poll every 30s for
 * N seconds then exit:
 *   php bin/collect.php --loop 540 --every 30 --all
 *
 * Robustness for the daemon case:
 *   - a non-blocking flock keeps a single instance;
 *   - every poll and the heartbeat write are individually guarded, so a bad
 *     fetch or a transient DB lock never kills the loop;
 *   - fatal startup errors sleep before exiting, so NFS's restart-on-exit can't
 *     hot-loop on a persistent failure;
 *   - --forever keeps stdout quiet (a periodic "alive" summary + errors only) to
 *     bound the daemon log; monitor via the API's /health `polls10m` instead.
 */

require __DIR__ . '/../src/bootstrap.php';

use Zrh\Adsb;
use Zrh\Airport;
use Zrh\Cli;
use Zrh\Collector;
use Zrh\Store;

/** Seconds between the daemon's "alive" summary lines (keeps the log bounded). */
const SUMMARY_EVERY_S = 600;
/** Backoff before exiting on a fatal error, so NFS restart-on-exit can't hot-loop. */
const RESTART_THROTTLE_S = 15;

$cfg = require __DIR__ . '/../config/app.php';
$args = Cli::parseArgs($argv);
$forever = $args['forever'];
$looping = $forever || $args['loopSeconds'] > 0;

$fatal = static function (string $msg) use ($forever): never {
    fwrite(STDERR, '[' . date('c') . "] FATAL: {$msg}\n");
    if ($forever) {
        sleep(RESTART_THROTTLE_S); // throttle NFS's restart-on-exit
    }
    exit(1);
};

// Single-instance guard.
$lock = fopen(sys_get_temp_dir() . '/zrh-collect.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, '[' . date('c') . "] another instance holds the lock — exiting\n");
    if ($forever) {
        sleep(RESTART_THROTTLE_S);
    }
    exit(0);
}

try {
    $store = Store::open($cfg['db']);
} catch (\Throwable $e) {
    $fatal('cannot open database: ' . $e->getMessage());
}

// --all polls every configured airport; otherwise the ones named on the CLI.
$icaos = $args['all']
    ? array_keys(json_decode((string) file_get_contents($cfg['airports']), true) ?: [])
    : $args['icaos'];

// Pre-load airport geometry once (reused across every poll in the loop).
$airports = [];
foreach ($icaos as $icao) {
    try {
        $airports[$icao] = Airport::load($icao, $cfg['airports']);
    } catch (\Throwable $e) {
        fwrite(STDERR, '[' . date('c') . "] {$icao} config error: " . $e->getMessage() . "\n");
    }
}
if ($airports === []) {
    $fatal('no valid airports to poll');
}

$deadline = microtime(true) + $args['loopSeconds'];
$polls = 0;
$totalMovements = 0;
$okPolls = 0;
$errPolls = 0;
$lastSummary = microtime(true);

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
            // Single/bounded-loop modes log interesting polls for visibility; a
            // --forever daemon stays quiet (see the periodic summary below).
            if (!$forever && (!$looping || $result['movements'] > 0)) {
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

    // Heartbeat — guarded so a transient DB lock can't kill the daemon.
    try {
        $store->recordPoll($nowMs);
    } catch (\Throwable $e) {
        fwrite(STDERR, '[' . date('c') . "] heartbeat ERROR: " . $e->getMessage() . "\n");
    }

    // Periodic "alive" summary keeps a long-running daemon's log bounded.
    if ($forever && microtime(true) - $lastSummary >= SUMMARY_EVERY_S) {
        fwrite(STDOUT, sprintf(
            "[%s] alive: polls=%d ok=%d err=%d movements=%d\n",
            date('c'),
            $polls,
            $okPolls,
            $errPolls,
            $totalMovements,
        ));
        $lastSummary = microtime(true);
    }

    if (!$looping) {
        break; // single poll
    }
    // Sleep to the next interval. In --forever mode there is no deadline;
    // otherwise stop once the next poll would fall past it.
    $next = $cycleStart + $args['everySeconds'];
    if (!$forever && $next >= $deadline) {
        break;
    }
    $sleep = $next - microtime(true);
    if ($sleep > 0) {
        usleep((int) ($sleep * 1_000_000));
    }
} while ($forever || microtime(true) < $deadline);

if ($looping && !$forever) {
    fwrite(STDOUT, sprintf(
        "[%s] loop done: polls=%d ok=%d err=%d movements=%d\n",
        date('c'),
        $polls,
        $okPolls,
        $errPolls,
        $totalMovements,
    ));
}

// Dead-man's switch for finite runs (a --forever daemon is monitored via /health).
$hcUrl = getenv('ZRH_HEALTHCHECK_URL') ?: (string) ($_SERVER['ZRH_HEALTHCHECK_URL'] ?? '');
if (!$forever && $okPolls > 0 && $hcUrl !== '') {
    $ch = curl_init($hcUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
    curl_exec($ch);
    curl_close($ch);
}

flock($lock, LOCK_UN);
fclose($lock);
exit($okPolls > 0 ? 0 : 1);
