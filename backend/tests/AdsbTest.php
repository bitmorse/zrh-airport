<?php

declare(strict_types=1);

use Zrh\Adsb;

/**
 * Normalisation of the readsb / ADSBExchange-v2 aircraft.json shape into the
 * fields the detector consumes — ported from src/data/adsb.ts normalise().
 */
return [
    'normalise: maps core fields' => function (): void {
        $ac = Adsb::normalise([
            'hex' => 'abc123', 'flight' => 'SWR123 ', 'lat' => 47.4, 'lon' => 8.5,
            'alt_baro' => 3000, 'alt_geom' => 3200, 'gs' => 180, 'track' => 145,
            'baro_rate' => 1200, 'seen_pos' => 2.0, 't' => 'A320', 'r' => 'HB-JCA',
        ]);
        Assert::same('abc123', $ac['hex']);
        Assert::same('SWR123', $ac['flight'], 'flight trimmed');
        Assert::false($ac['onGround']);
        Assert::same(3000, $ac['altFt']);
        Assert::same(1200, $ac['verticalRateFpm']);
        Assert::same('A320', $ac['type']);
    },

    'normalise: alt_baro "ground" => onGround, null altFt' => function (): void {
        $ac = Adsb::normalise([
            'hex' => 'g1', 'lat' => 47.4, 'lon' => 8.5, 'alt_baro' => 'ground', 'gs' => 12,
        ]);
        Assert::true($ac['onGround']);
        Assert::true($ac['altFt'] === null, 'altFt null on ground');
    },

    'normalise: falls back geom_rate when baro_rate missing' => function (): void {
        $ac = Adsb::normalise([
            'hex' => 'v1', 'lat' => 47.4, 'lon' => 8.5, 'alt_baro' => 2000, 'geom_rate' => -800,
        ]);
        Assert::same(-800, $ac['verticalRateFpm']);
    },

    'normalise: rejects rows without a position' => function (): void {
        Assert::true(Adsb::normalise(['hex' => 'x', 'alt_baro' => 1000]) === null, 'no lat/lon');
        Assert::true(Adsb::normalise(['lat' => 47.4, 'lon' => 8.5]) === null, 'no hex');
    },
];
