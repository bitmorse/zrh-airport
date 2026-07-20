<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Collector CLI argument parsing.
 *
 *   collect.php [--loop <seconds>] [--every <seconds>] [ICAO ...]
 *
 * Single-shot by default (loopSeconds = 0). With --loop, the collector polls
 * every `every` seconds for up to `loop` seconds, then exits — so a single cron
 * kick (NFS scheduled tasks run at most every ~10 min) yields continuous
 * sub-minute cadence between kicks.
 */
final class Cli
{
    private const DEFAULT_ICAO = 'LSZH';
    private const DEFAULT_EVERY = 30;
    private const MIN_EVERY = 5;

    /** @return array{loopSeconds:int,everySeconds:int,icaos:array<int,string>} */
    public static function parseArgs(array $argv): array
    {
        $tokens = array_slice($argv, 1);
        $loopSeconds = 0;
        $everySeconds = self::DEFAULT_EVERY;
        $icaos = [];

        for ($i = 0; $i < count($tokens); $i++) {
            $t = $tokens[$i];
            if ($t === '--loop') {
                $loopSeconds = (int) ($tokens[++$i] ?? 0);
            } elseif (str_starts_with($t, '--loop=')) {
                $loopSeconds = (int) substr($t, 7);
            } elseif ($t === '--every') {
                $everySeconds = (int) ($tokens[++$i] ?? self::DEFAULT_EVERY);
            } elseif (str_starts_with($t, '--every=')) {
                $everySeconds = (int) substr($t, 8);
            } elseif ($t !== '' && $t[0] !== '-') {
                $icaos[] = strtoupper($t);
            }
        }

        if ($icaos === []) {
            $icaos = [self::DEFAULT_ICAO];
        }

        return [
            'loopSeconds' => max(0, $loopSeconds),
            'everySeconds' => max(self::MIN_EVERY, $everySeconds),
            'icaos' => $icaos,
        ];
    }
}
