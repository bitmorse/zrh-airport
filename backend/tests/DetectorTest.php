<?php

declare(strict_types=1);

use Zrh\Airport;
use Zrh\Detector;

/**
 * The minimal, single-poll-plus-persisted-state movement detector. This is the
 * backend's reimplementation of the frontend's detection, reduced to just
 * landings and takeoffs per runway end. Tests drive it with synthetic snapshots
 * placed on real ZRH thresholds, using each end's derived bearing as the track.
 */

function zrh(): Airport
{
    static $ap = null;
    return $ap ??= Airport::load('LSZH', __DIR__ . '/../config/airports.json');
}

/** The derived RunwayEnd (with threshold + bearingDeg) for an id like "28". */
function rwEnd(string $id): array
{
    foreach (zrh()->ends as $e) {
        if ($e['id'] === $id) {
            return $e;
        }
    }
    throw new RuntimeException("no end {$id}");
}

/** Build a normalised aircraft sitting on end $id's threshold, moving along it. */
function ac(string $hex, string $endId, array $over): array
{
    $e = rwEnd($endId);
    return array_merge([
        'hex' => $hex,
        'lat' => $e['threshold']['lat'],
        'lon' => $e['threshold']['lon'],
        'altFt' => null,
        'onGround' => false,
        'gs' => null,
        'track' => $e['bearingDeg'],
        'verticalRateFpm' => null,
    ], $over);
}

const FIELD = 1416.0; // ZRH field elevation ft

return [
    'landing: air->ground on a runway end counts once, tagged with that end' => function (): void {
        $ap = zrh();
        // Poll 1: on short final to 28, airborne and descending.
        $t1 = 1_000_000;
        $r1 = Detector::detect($ap, [], [
            ac('a1', '28', ['onGround' => false, 'altFt' => FIELD + 150, 'gs' => 140, 'verticalRateFpm' => -700]),
        ], $t1);
        Assert::count(0, $r1['movements'], 'no movement while still airborne');

        // Poll 2 (+60s): now on the ground rolling out on 28.
        $t2 = $t1 + 60_000;
        $r2 = Detector::detect($ap, $r1['tracker'], [
            ac('a1', '28', ['onGround' => true, 'gs' => 45]),
        ], $t2);
        Assert::count(1, $r2['movements'], 'one landing on touchdown');
        Assert::same('landing', $r2['movements'][0]['kind']);
        Assert::same('28', $r2['movements'][0]['end']);
        Assert::same('a1', $r2['movements'][0]['hex']);
    },

    'landing: null-track touchdown is tagged to the approach end, not the first-listed one' => function (): void {
        $ap = zrh();
        // Approach to 34 (track present → the end is unambiguous while airborne).
        $t1 = 1_500_000;
        $r1 = Detector::detect($ap, [], [
            ac('n1', '34', ['onGround' => false, 'altFt' => FIELD + 160, 'gs' => 140, 'verticalRateFpm' => -700]),
        ], $t1);
        Assert::count(0, $r1['movements'], 'still airborne');

        // Touchdown on the 16/34 strip with NO track (common for surface targets).
        // Without the approach-end memory this would wrongly tag "16" (first-listed).
        $t2 = $t1 + 60_000;
        $r2 = Detector::detect($ap, $r1['tracker'], [
            ac('n1', '34', ['onGround' => true, 'gs' => 45, 'track' => null]),
        ], $t2);
        Assert::count(1, $r2['movements'], 'one landing');
        Assert::same('34', $r2['movements'][0]['end'], 'tagged to the approach end 34');
    },

    'takeoff: a go-around (was airborne on approach) is NOT counted as a takeoff' => function (): void {
        $ap = zrh();
        // Poll 1: on approach to 16, airborne and descending.
        $t1 = 1_600_000;
        $r1 = Detector::detect($ap, [], [
            ac('ga1', '16', ['onGround' => false, 'altFt' => FIELD + 400, 'gs' => 150, 'verticalRateFpm' => -600]),
        ], $t1);
        Assert::count(0, $r1['movements'], 'descending, nothing');

        // Poll 2: goes around — now climbing, aligned, low. Was previously airborne
        // (not a departure off the ground), so it must NOT count as a takeoff.
        $t2 = $t1 + 60_000;
        $r2 = Detector::detect($ap, $r1['tracker'], [
            ac('ga1', '16', ['onGround' => false, 'altFt' => FIELD + 500, 'gs' => 160, 'verticalRateFpm' => 1800]),
        ], $t2);
        Assert::count(0, $r2['movements'], 'go-around is not a takeoff');
    },

    'landing: not double-counted while it keeps rolling within cooldown' => function (): void {
        $ap = zrh();
        $t1 = 2_000_000;
        $r1 = Detector::detect($ap, [], [
            ac('b1', '14', ['onGround' => false, 'altFt' => FIELD + 120, 'gs' => 135, 'verticalRateFpm' => -600]),
        ], $t1);
        $t2 = $t1 + 60_000;
        $r2 = Detector::detect($ap, $r1['tracker'], [
            ac('b1', '14', ['onGround' => true, 'gs' => 40]),
        ], $t2);
        Assert::count(1, $r2['movements'], 'counted once');
        // Still on the runway 60s later — must not count again.
        $t3 = $t2 + 60_000;
        $r3 = Detector::detect($ap, $r2['tracker'], [
            ac('b1', '14', ['onGround' => true, 'gs' => 15]),
        ], $t3);
        Assert::count(0, $r3['movements'], 'no re-count during rollout');
    },

    'landing: an aircraft first seen already on the ground is NOT a landing' => function (): void {
        $ap = zrh();
        // No prior state — could just be taxiing; must not fabricate a landing.
        $r = Detector::detect($ap, [], [
            ac('c1', '28', ['onGround' => true, 'gs' => 20, 'track' => null]),
        ], 3_000_000);
        Assert::count(0, $r['movements']);
    },

    'takeoff: low aligned climb-out past the threshold counts once' => function (): void {
        $ap = zrh();
        $t1 = 4_000_000;
        // Airborne, low, climbing, aligned with 16 — a departure.
        $r1 = Detector::detect($ap, [], [
            ac('d1', '16', ['onGround' => false, 'altFt' => FIELD + 350, 'gs' => 165, 'verticalRateFpm' => 2200]),
        ], $t1);
        Assert::count(1, $r1['movements'], 'one takeoff');
        Assert::same('takeoff', $r1['movements'][0]['kind']);
        Assert::same('16', $r1['movements'][0]['end']);
    },

    'takeoff: a descending aircraft (arrival) on the same corridor is NOT a takeoff' => function (): void {
        $ap = zrh();
        $r = Detector::detect($ap, [], [
            ac('e1', '16', ['onGround' => false, 'altFt' => FIELD + 350, 'gs' => 140, 'verticalRateFpm' => -800]),
        ], 5_000_000);
        Assert::count(0, $r['movements'], 'descending => not a takeoff');
    },

    'ignores traffic far from any runway (overflight)' => function (): void {
        $ap = zrh();
        // 10 km north of the field, cruising — not aligned with any centreline.
        $r = Detector::detect($ap, [], [[
            'hex' => 'f1', 'lat' => 47.56, 'lon' => 8.5492,
            'altFt' => FIELD + 3000, 'onGround' => false,
            'gs' => 300, 'track' => 90.0, 'verticalRateFpm' => 0,
        ]], 6_000_000);
        Assert::count(0, $r['movements']);
    },

    'tracker: prunes stale hexes but keeps recent ones for cooldown' => function (): void {
        $ap = zrh();
        $t1 = 7_000_000;
        $r1 = Detector::detect($ap, [], [
            ac('g1', '28', ['onGround' => false, 'altFt' => FIELD + 900, 'gs' => 150, 'verticalRateFpm' => -500]),
        ], $t1);
        Assert::true(isset($r1['tracker']['g1']), 'g1 tracked');
        // Much later, g1 absent from the snapshot and older than cooldown -> pruned.
        $t2 = $t1 + 30 * 60_000; // 30 min later
        $r2 = Detector::detect($ap, $r1['tracker'], [], $t2, 20 * 60_000);
        Assert::false(isset($r2['tracker']['g1']), 'g1 pruned after cooldown');
    },
];
