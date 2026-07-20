<?php

declare(strict_types=1);

/**
 * Collector entry point — run once per cron tick by an NFS Scheduled Task:
 *
 *   php /home/protected/backend/bin/collect.php LSZH
 *
 * Optionally pass several airports: `... collect.php LSZH VTBS`. A non-blocking
 * flock guards against overlapping runs if a poll is slow. On success it can ping
 * a healthchecks.io URL (ZRH_HEALTHCHECK_URL) as a dead-man's switch.
 */

require __DIR__ . '/../src/bootstrap.php';

use Zrh\Adsb;
use Zrh\Airport;
use Zrh\Collector;
use Zrh\Store;

$cfg = require __DIR__ . '/../config/app.php';

$icaos = array_slice($argv, 1);
if ($icaos === []) {
    $icaos = ['LSZH'];
}

$lockPath = sys_get_temp_dir() . '/zrh-collect.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "[" . date('c') . "] previous run still in progress — skipping\n");
    exit(0);
}

$store = Store::open($cfg['db']);
$nowMs = (int) (microtime(true) * 1000);
$failed = false;

foreach ($icaos as $icao) {
    try {
        $airport = Airport::load($icao, $cfg['airports']);
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
    } catch (\Throwable $e) {
        $failed = true;
        fwrite(STDERR, "[" . date('c') . "] {$icao} ERROR: " . $e->getMessage() . "\n");
    }
}

// Dead-man's switch: only ping on a fully successful sweep.
$hcUrl = getenv('ZRH_HEALTHCHECK_URL');
if (!$failed && is_string($hcUrl) && $hcUrl !== '') {
    $ch = curl_init($hcUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
    curl_exec($ch);
    curl_close($ch);
}

flock($lock, LOCK_UN);
fclose($lock);
exit($failed ? 1 : 0);
