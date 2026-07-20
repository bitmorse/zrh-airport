<?php

declare(strict_types=1);

use Zrh\Geo;

/**
 * Geometry helpers, ported 1:1 from src/lib/geo.ts. Values are cross-checked
 * against the equivalent TS behaviour.
 */
return [
    'toLocalMeters: origin maps to (0,0)' => function (): void {
        $v = Geo::toLocalMeters(['lat' => 47.0, 'lon' => 8.0], ['lat' => 47.0, 'lon' => 8.0]);
        Assert::near(0.0, $v['x'], 1e-6, 'x');
        Assert::near(0.0, $v['y'], 1e-6, 'y');
    },

    'toLocalMeters: north offset is positive y, ~111.19m per 0.001deg lat' => function (): void {
        $v = Geo::toLocalMeters(['lat' => 47.0, 'lon' => 8.0], ['lat' => 47.001, 'lon' => 8.0]);
        Assert::near(0.0, $v['x'], 1e-6, 'x');
        Assert::near(111.19, $v['y'], 0.5, 'y');
    },

    'toLocalMeters: east offset shrinks by cos(lat)' => function (): void {
        $v = Geo::toLocalMeters(['lat' => 47.0, 'lon' => 8.0], ['lat' => 47.0, 'lon' => 8.001]);
        // 0.001deg lon * (pi/180) * R * cos(47deg) ≈ 75.83 m
        Assert::near(75.83, $v['x'], 0.5, 'x');
        Assert::near(0.0, $v['y'], 1e-6, 'y');
    },

    'angleDelta: wraps around 360' => function (): void {
        Assert::near(0.0, Geo::angleDelta(10, 10));
        Assert::near(20.0, Geo::angleDelta(350, 10), 1e-9);
        Assert::near(180.0, Geo::angleDelta(0, 180), 1e-9);
        Assert::near(10.0, Geo::angleDelta(5, 355), 1e-9);
    },

    'bearing: due north ~0, due east ~90' => function (): void {
        Assert::near(0.0, Geo::bearing(['lat' => 47.0, 'lon' => 8.0], ['lat' => 47.1, 'lon' => 8.0]), 0.5, 'north');
        Assert::near(90.0, Geo::bearing(['lat' => 47.0, 'lon' => 8.0], ['lat' => 47.0, 'lon' => 8.1]), 1.0, 'east');
    },

    'projectOntoSegment: on-line point has ~0 crossTrack' => function (): void {
        $a = ['x' => 0.0, 'y' => 0.0];
        $b = ['x' => 100.0, 'y' => 0.0];
        $proj = Geo::projectOntoSegment(['x' => 50.0, 'y' => 0.0], $a, $b);
        Assert::near(0.0, $proj['crossTrack'], 1e-9, 'cross');
        Assert::near(50.0, $proj['alongTrack'], 1e-9, 'along');
        Assert::near(100.0, $proj['len'], 1e-9, 'len');
    },

    'projectOntoSegment: perpendicular offset measured as crossTrack' => function (): void {
        $a = ['x' => 0.0, 'y' => 0.0];
        $b = ['x' => 100.0, 'y' => 0.0];
        $proj = Geo::projectOntoSegment(['x' => 30.0, 'y' => 25.0], $a, $b);
        Assert::near(25.0, $proj['crossTrack'], 1e-9, 'cross');
        Assert::near(30.0, $proj['alongTrack'], 1e-9, 'along');
    },

    'projectOntoSegment: point beyond a has negative alongTrack' => function (): void {
        $a = ['x' => 0.0, 'y' => 0.0];
        $b = ['x' => 100.0, 'y' => 0.0];
        $proj = Geo::projectOntoSegment(['x' => -40.0, 'y' => 0.0], $a, $b);
        Assert::near(-40.0, $proj['alongTrack'], 1e-9, 'along');
    },
];
