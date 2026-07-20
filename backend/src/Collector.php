<?php

declare(strict_types=1);

namespace Zrh;

/**
 * One collection cycle: reload the persisted detector state, take an ADS-B
 * snapshot, detect landings/takeoffs, write them, save the updated state, and
 * prune anything past the retention window. Designed to be invoked once per cron
 * tick (see bin/collect.php) — all cross-poll memory lives in the Store, so the
 * process can exit between runs.
 *
 * The aircraft source is injected so tests can drive it without a network.
 */
final class Collector
{
    public const RETENTION_DAYS = 60;
    public const COOLDOWN_MS = 20 * 60 * 1000;

    private const DAY_MS = 86_400_000;

    /**
     * @param callable():array<int,array> $fetchAircraft returns a normalised snapshot
     * @return array{provider?:string,movements:int,inserted:int,tracked:int,pruned:int}
     */
    public static function runCycle(
        Airport $airport,
        Store $store,
        callable $fetchAircraft,
        int $nowMs,
        int $retentionDays = self::RETENTION_DAYS,
        int $cooldownMs = self::COOLDOWN_MS,
    ): array {
        $icao = $airport->icao;
        $tz = $airport->timeZone ?? 'UTC';

        $tracker = $store->loadTracker($icao);
        $aircraft = $fetchAircraft();

        $res = Detector::detect($airport, $tracker, $aircraft, $nowMs, $cooldownMs);
        $inserted = $store->insertMovements($icao, $res['movements'], $tz);
        $store->saveTracker($icao, $res['tracker']);
        $pruned = $store->pruneMovements($icao, $nowMs - $retentionDays * self::DAY_MS);

        return [
            'movements' => count($res['movements']),
            'inserted' => $inserted,
            'tracked' => count($res['tracker']),
            'pruned' => $pruned,
        ];
    }

    /** Number of days of hourly weather kept (see the plan: longer than movements). */
    public const WEATHER_RETENTION_DAYS = 365;

    /**
     * One weather cycle: fetch the hourly forecast/observation set and upsert it,
     * then prune beyond the retention window. Stateless (no tracker). The fetcher
     * is injected so tests need no network. Returns the number of hours written.
     *
     * @param callable():array<int,array> $fetchWeather normalised Weather rows
     */
    public static function runWeather(
        Airport $airport,
        Store $store,
        callable $fetchWeather,
        int $nowMs,
        int $retentionDays = self::WEATHER_RETENTION_DAYS,
    ): int {
        $icao = $airport->icao;
        $tz = $airport->timeZone ?? 'UTC';

        $rows = $fetchWeather();
        $written = $store->upsertWeather($icao, $rows, $tz, $nowMs);
        $store->pruneWeather($icao, $nowMs - $retentionDays * self::DAY_MS);

        return $written;
    }
}
