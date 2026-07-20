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
    private const HOURLY = 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,'
        . 'wind_gusts_10m,visibility,cloud_cover,surface_pressure';
    private const TIMEOUT_S = 8;

    /**
     * @return array<int,array{tsMs:int,windDir:?int,windKt:?float,gustKt:?float,tempC:?float,precipMm:?float,visibilityM:?float,cloudPct:?float,pressureHpa:?float}>
     */
    public static function fetchHourly(array $center, ?callable $httpGet = null): array
    {
        $httpGet ??= [self::class, 'curlGet'];
        $url = self::BASE_URL . '?' . http_build_query([
            'latitude' => $center['lat'],
            'longitude' => $center['lon'],
            'hourly' => self::HOURLY,
            'wind_speed_unit' => 'kn',
            'past_days' => 1,
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
        $times = $h['time'];
        $rows = [];
        foreach ($times as $i => $time) {
            $tsMs = self::hourToMs((string) $time);
            if ($tsMs === null) {
                continue;
            }
            $rows[] = [
                'tsMs' => $tsMs,
                'windDir' => self::intAt($h, 'wind_direction_10m', $i),
                'windKt' => self::floatAt($h, 'wind_speed_10m', $i),
                'gustKt' => self::floatAt($h, 'wind_gusts_10m', $i),
                'tempC' => self::floatAt($h, 'temperature_2m', $i),
                'precipMm' => self::floatAt($h, 'precipitation', $i),
                'visibilityM' => self::floatAt($h, 'visibility', $i),
                'cloudPct' => self::floatAt($h, 'cloud_cover', $i),
                'pressureHpa' => self::floatAt($h, 'surface_pressure', $i),
            ];
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
