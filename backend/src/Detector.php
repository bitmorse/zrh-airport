<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Minimal landing/takeoff detector — the backend counterpart to the frontend's
 * detection (src/domain/departures.ts, predictions.ts, movements.ts), reduced to
 * just the two countable events. Because the cron collector is stateless between
 * runs, the per-aircraft memory the frontend keeps in React refs lives here in a
 * persisted `tracker` map (hex → last state), passed in and returned each poll.
 *
 * Detection is deliberately transition-based so it's robust at the 60s cadence:
 *   landing — an aircraft that was airborne last poll and is now on the ground,
 *             on a runway strip aligned with a landing direction (rollout);
 *   takeoff — an aircraft airborne, low, aligned with a runway and climbing
 *             (the closest ADS-B proxy for a departure; arrivals are descending).
 * Each event is de-duplicated per (hex, kind) for `cooldownMs`, mirroring the
 * frontend's MOVEMENT_COOLDOWN_MS.
 *
 * Threshold constants mirror src/domain/departures.ts so the two detectors stay
 * close; keep them in sync when tuning either side.
 */
final class Detector
{
    private const HALF_WIDTH_M = 220.0;    // lateral tolerance around the centreline
    private const BEFORE_M = 300.0;        // corridor just short of the threshold
    private const END_OVERRUN_M = 8000.0;  // corridor past the far end (climb-out / approach)
    private const TRACK_TOL_DEG = 45.0;
    private const CLIMB_MIN_FPM = 200.0;
    private const CLIMB_MAX_AGL_FT = 4000.0; // only count climb-out close to the field

    /**
     * @param array<string,array> $tracker hex → {onground,alt_agl,seen,takeoff_at,landing_at}
     * @param array<int,array>    $aircraft normalised snapshot (see Adsb::normalise)
     * @return array{movements: array<int,array{kind:string,hex:string,end:string,ts:int}>, tracker: array<string,array>}
     */
    public static function detect(Airport $airport, array $tracker, array $aircraft, int $nowMs, int $cooldownMs = 1200000): array
    {
        $field = $airport->fieldElevationFt;
        $movements = [];
        $next = [];

        foreach ($aircraft as $ac) {
            $hex = (string) $ac['hex'];
            $prev = $tracker[$hex] ?? null;

            $onGround = (bool) $ac['onGround'];
            $altFt = $ac['altFt'] ?? null;
            $altAgl = $altFt !== null ? (float) $altFt - $field : ($onGround ? 0.0 : null);
            $track = $ac['track'] ?? null;
            $vrate = $ac['verticalRateFpm'] ?? null;

            $best = self::alignedEnd($airport, (float) $ac['lat'], (float) $ac['lon'], $track);

            $kind = null;
            if ($best !== null) {
                if (
                    !$onGround
                    && $vrate !== null && (float) $vrate >= self::CLIMB_MIN_FPM
                    && $altAgl !== null && $altAgl <= self::CLIMB_MAX_AGL_FT
                    && $best['alongTrack'] >= -self::BEFORE_M
                ) {
                    $kind = 'takeoff';
                } elseif (
                    $onGround
                    && $prev !== null && (int) $prev['onground'] === 0
                    && $best['alongTrack'] >= -self::BEFORE_M
                    && $best['alongTrack'] <= $best['len']
                ) {
                    $kind = 'landing';
                }
            }

            $takeoffAt = $prev['takeoff_at'] ?? null;
            $landingAt = $prev['landing_at'] ?? null;

            if ($kind === 'takeoff' && self::armed($takeoffAt, $nowMs, $cooldownMs)) {
                $movements[] = ['kind' => 'takeoff', 'hex' => $hex, 'end' => $best['id'], 'ts' => $nowMs];
                $takeoffAt = $nowMs;
            } elseif ($kind === 'landing' && self::armed($landingAt, $nowMs, $cooldownMs)) {
                $movements[] = ['kind' => 'landing', 'hex' => $hex, 'end' => $best['id'], 'ts' => $nowMs];
                $landingAt = $nowMs;
            }

            $next[$hex] = [
                'onground' => $onGround ? 1 : 0,
                'alt_agl' => $altAgl,
                'seen' => $nowMs,
                'takeoff_at' => $takeoffAt,
                'landing_at' => $landingAt,
            ];
        }

        // Carry over recently-seen aircraft that dropped off this poll, so their
        // last state (for the air→ground transition) and cooldown survive brief
        // feed gaps; prune anything older than the cooldown window.
        foreach ($tracker as $hex => $st) {
            if (isset($next[$hex])) {
                continue;
            }
            if ($nowMs - (int) $st['seen'] < $cooldownMs) {
                $next[$hex] = $st;
            }
        }

        return ['movements' => $movements, 'tracker' => $next];
    }

    private static function armed(?int $lastAt, int $nowMs, int $cooldownMs): bool
    {
        return $lastAt === null || $nowMs - $lastAt >= $cooldownMs;
    }

    /**
     * The runway end this aircraft is best aligned with (nearest centreline within
     * tolerance and inside the approach/climb corridor), or null. When a track is
     * available it must point roughly along the end's direction of travel, which
     * is what distinguishes the two opposing ends of one physical strip.
     *
     * @return array{id:string,crossTrack:float,alongTrack:float,len:float}|null
     */
    private static function alignedEnd(Airport $airport, float $lat, float $lon, ?float $track): ?array
    {
        $p = Geo::toLocalMeters($airport->arp, ['lat' => $lat, 'lon' => $lon]);
        $best = null;
        foreach ($airport->ends as $e) {
            $proj = Geo::projectOntoSegment($p, $e['a'], $e['b']);
            if ($proj['crossTrack'] > self::HALF_WIDTH_M) {
                continue;
            }
            if ($proj['alongTrack'] < -self::BEFORE_M || $proj['alongTrack'] > $proj['len'] + self::END_OVERRUN_M) {
                continue;
            }
            if ($track !== null && Geo::angleDelta($track, (float) $e['bearingDeg']) > self::TRACK_TOL_DEG) {
                continue;
            }
            if ($best === null || $proj['crossTrack'] < $best['crossTrack']) {
                $best = [
                    'id' => $e['id'],
                    'crossTrack' => $proj['crossTrack'],
                    'alongTrack' => $proj['alongTrack'],
                    'len' => $proj['len'],
                ];
            }
        }
        return $best;
    }
}
