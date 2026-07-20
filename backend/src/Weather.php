<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Hourly weather ingestion from Open-Meteo (free, no API key). Mirrors Adsb: a
 * keyless HTTP fetch with an injectable transport, plus a `normalise()` that maps
 * the provider's shape into clean rows the Store persists.
 *
 * Open-Meteo returns parallel arrays under `hourly` (time[] + one array per
 * field); we zip them by index into one row per hour. Wind is the field that
 * matters most for runway utilisation, so it's requested in knots.
 */
final class Weather
{
    private const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
    private const TIMEOUT_S = 8;

    /**
     * Fetch hourly weather around $center. `$pastDays` sets how far back to
     * request (Open-Meteo allows up to 92) — larger values let a restart backfill
     * any gap left by downtime.
     *
     * @return array<int,array<string,mixed>> normalised rows keyed by WEATHER_FIELDS apiKeys + tsMs
     */
    public static function fetchHourly(array $center, int $pastDays = 1, ?callable $httpGet = null): array
    {
        $httpGet ??= [self::class, 'curlGet'];
        $hourly = implode(',', array_column(Store::WEATHER_FIELDS, 3));
        $url = self::BASE_URL . '?' . http_build_query([
            'latitude' => $center['lat'],
            'longitude' => $center['lon'],
            'hourly' => $hourly,
            'wind_speed_unit' => 'kn',
            'past_days' => max(1, $pastDays),
            'forecast_days' => 2,
            'timezone' => 'UTC',
        ]);
        // http_build_query encodes the commas in `hourly`; Open-Meteo accepts that.
        $body = $httpGet($url, self::TIMEOUT_S);
        if ($body === null) {
            throw new \RuntimeException('weather: empty response');
        }
        $json = json_decode($body, true);
        return is_array($json) ? self::normalise($json) : [];
    }

    /** Zip the `hourly` arrays into one row per hour; skip if there are no times. */
    public static function normalise(array $json): array
    {
        $h = $json['hourly'] ?? null;
        if (!is_array($h) || !isset($h['time']) || !is_array($h['time'])) {
            return [];
        }
        $rows = [];
        foreach ($h['time'] as $i => $time) {
            $tsMs = self::hourToMs((string) $time);
            if ($tsMs === null) {
                continue;
            }
            $row = ['tsMs' => $tsMs];
            foreach (Store::WEATHER_FIELDS as [$col, $type, $apiKey, $source, $isInt]) {
                $row[$apiKey] = $isInt ? self::intAt($h, $source, $i) : self::floatAt($h, $source, $i);
            }
            $rows[] = $row;
        }
        return $rows;
    }

    /** Open-Meteo hour string ("YYYY-MM-DDTHH:MM", UTC) → epoch ms, or null. */
    private static function hourToMs(string $time): ?int
    {
        if ($time === '') {
            return null;
        }
        try {
            $dt = new \DateTimeImmutable($time, new \DateTimeZone('UTC'));
        } catch (\Throwable $e) {
            return null;
        }
        return $dt->getTimestamp() * 1000;
    }

    private static function intAt(array $h, string $key, int $i): ?int
    {
        $v = $h[$key][$i] ?? null;
        return is_numeric($v) ? (int) round((float) $v) : null;
    }

    private static function floatAt(array $h, string $key, int $i): ?float
    {
        $v = $h[$key][$i] ?? null;
        return is_numeric($v) ? (float) $v : null;
    }

    private static function curlGet(string $url, int $timeoutS): ?string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeoutS,
            CURLOPT_CONNECTTIMEOUT => $timeoutS,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'zrh-airport-stats/1.0 (+https://bitmorse.com)',
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false || $err !== '') {
            throw new \RuntimeException($err !== '' ? $err : 'curl failed');
        }
        if ($status < 200 || $status >= 300) {
            throw new \RuntimeException("HTTP {$status}");
        }
        return is_string($body) ? $body : null;
    }
}
