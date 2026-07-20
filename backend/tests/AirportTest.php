<?php

declare(strict_types=1);

use Zrh\Airport;

/**
 * Airport geometry derivation, mirroring src/domain/airport.ts buildAirport:
 * each physical runway yields two opposing ends, each with a bearing of travel
 * and a centreline pre-projected to local metres around the ARP.
 */

function loadZrh(): Airport
{
    return Airport::load('LSZH', __DIR__ . '/../config/airports.json');
}

return [
    'load: basic config fields' => function (): void {
        $ap = loadZrh();
        Assert::same('LSZH', $ap->icao);
        Assert::same('Europe/Zurich', $ap->timeZone);
        Assert::near(1416.0, $ap->fieldElevationFt, 1e-9);
        Assert::near(47.4647, $ap->arp['lat'], 1e-9);
    },

    'ends: 3 runways -> 6 ends' => function (): void {
        $ap = loadZrh();
        Assert::count(6, $ap->ends);
    },

    'ends: 16 and 34 are opposite, strip 16/34' => function (): void {
        $ap = loadZrh();
        $byId = [];
        foreach ($ap->ends as $e) {
            $byId[$e['id']] = $e;
        }
        Assert::same('34', $byId['16']['opposite']);
        Assert::same('16', $byId['34']['opposite']);
        Assert::same('16/34', $byId['16']['strip']);
    },

    'ends: runway 16 bearing is roughly 155 deg (points SSE)' => function (): void {
        $ap = loadZrh();
        $byId = [];
        foreach ($ap->ends as $e) {
            $byId[$e['id']] = $e;
        }
        // 16 threshold -> 34 threshold heads SSE; true heading ~155 (magnetic ~160).
        Assert::near(155.0, $byId['16']['bearingDeg'], 6.0, 'rwy16 bearing');
        // Opposite end (34) points back the other way (~335).
        Assert::near(335.0, $byId['34']['bearingDeg'], 6.0, 'rwy34 bearing');
    },

    'ends: local centreline endpoints a=threshold, b=farEnd' => function (): void {
        $ap = loadZrh();
        $byId = [];
        foreach ($ap->ends as $e) {
            $byId[$e['id']] = $e;
        }
        $e16 = $byId['16'];
        // a is this end's threshold in local metres; b is the far end.
        Assert::true(isset($e16['a']['x'], $e16['a']['y']), 'a is a vec2');
        Assert::true(isset($e16['b']['x'], $e16['b']['y']), 'b is a vec2');
        // Runway 16/34 is ~2.5 km long; local segment length should be in that range.
        $len = hypot($e16['b']['x'] - $e16['a']['x'], $e16['b']['y'] - $e16['a']['y']);
        Assert::true($len > 2000 && $len < 4000, "rwy len plausible, got {$len}");
    },
];
