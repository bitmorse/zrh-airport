<?php

declare(strict_types=1);

use Zrh\Weather;

/**
 * Hourly weather ingestion from Open-Meteo's `/v1/forecast` response — parallel
 * `hourly` arrays zipped into one row per hour (ported style from Adsb::normalise).
 */

/** A small, realistic Open-Meteo hourly payload (UTC times, knots). */
function openMeteoFixture(): array
{
    return [
        'hourly' => [
            'time' => ['2026-07-20T12:00', '2026-07-20T13:00', '2026-07-20T14:00'],
            'temperature_2m' => [24.1, 25.3, 26.0],
            'precipitation' => [0.0, 0.2, 0.0],
            'wind_speed_10m' => [8.0, 12.5, 14.0],
            'wind_direction_10m' => [240, 250, 255],
            'wind_gusts_10m' => [15.0, 20.0, 22.0],
            'visibility' => [24140.0, 20000.0, 18000.0],
            'cloud_cover' => [10, 40, 75],
            'surface_pressure' => [1017.2, 1016.8, 1016.1],
        ],
    ];
}

return [
    'normalise: zips hourly arrays into one row per hour' => function (): void {
        $rows = Weather::normalise(openMeteoFixture());
        Assert::count(3, $rows, 'three hours');
        $r = $rows[1];
        Assert::same(250, $r['windDir'], 'wind dir');
        Assert::near(12.5, $r['windKt'], 1e-9, 'wind kt');
        Assert::near(20.0, $r['gustKt'], 1e-9, 'gust kt');
        Assert::near(25.3, $r['tempC'], 1e-9, 'temp');
        Assert::near(0.2, $r['precipMm'], 1e-9, 'precip');
        Assert::near(20000.0, $r['visibilityM'], 1e-9, 'visibility');
        Assert::near(40.0, $r['cloudPct'], 1e-9, 'cloud');
        Assert::near(1016.8, $r['pressureHpa'], 1e-9, 'pressure');
    },

    'normalise: parses the UTC hour to epoch ms' => function (): void {
        $rows = Weather::normalise(openMeteoFixture());
        $expected = (new DateTimeImmutable('2026-07-20T12:00:00', new DateTimeZone('UTC')))->getTimestamp() * 1000;
        Assert::same($expected, $rows[0]['tsMs'], 'first hour tsMs (UTC)');
    },

    'normalise: tolerates missing fields (nulls), still keyed by time' => function (): void {
        $rows = Weather::normalise([
            'hourly' => [
                'time' => ['2026-07-20T12:00'],
                'wind_direction_10m' => [200],
                'wind_speed_10m' => [9.0],
                // other fields absent
            ],
        ]);
        Assert::count(1, $rows);
        Assert::same(200, $rows[0]['windDir']);
        Assert::true($rows[0]['tempC'] === null, 'missing temp is null');
        Assert::true($rows[0]['gustKt'] === null, 'missing gust is null');
    },

    'normalise: empty / missing hourly block -> no rows' => function (): void {
        Assert::count(0, Weather::normalise([]));
        Assert::count(0, Weather::normalise(['hourly' => ['time' => []]]));
    },

    'fetchHourly: uses the injected transport and returns normalised rows' => function (): void {
        $rows = Weather::fetchHourly(
            ['lat' => 47.4647, 'lon' => 8.5492],
            fn (string $url, int $to) => json_encode(openMeteoFixture()),
        );
        Assert::count(3, $rows);
        Assert::same(240, $rows[0]['windDir']);
    },

    'fetchHourly: builds an Open-Meteo URL with the airport coords and knots' => function (): void {
        $seen = '';
        Weather::fetchHourly(
            ['lat' => 13.6811, 'lon' => 100.747],
            function (string $url, int $to) use (&$seen) {
                $seen = $url;
                return json_encode(openMeteoFixture());
            },
        );
        Assert::true(str_contains($seen, 'latitude=13.6811'), 'lat in url');
        Assert::true(str_contains($seen, 'longitude=100.747'), 'lon in url');
        Assert::true(str_contains($seen, 'wind_speed_unit=kn'), 'knots');
        Assert::true(str_contains($seen, 'wind_direction_10m'), 'requests wind dir');
    },
];
