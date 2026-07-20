<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Planar geometry helpers, ported 1:1 from src/lib/geo.ts and the `bearing`
 * helper from src/domain/airport.ts. Points are ['lat'=>float,'lon'=>float];
 * local vectors are ['x'=>east_m,'y'=>north_m].
 */
final class Geo
{
    private const R_EARTH = 6371000.0; // metres
    private const DEG = M_PI / 180.0;

    /** Equirectangular projection to local metres around $origin. */
    public static function toLocalMeters(array $origin, array $p): array
    {
        $latRad = $origin['lat'] * self::DEG;
        return [
            'x' => ($p['lon'] - $origin['lon']) * self::DEG * self::R_EARTH * cos($latRad),
            'y' => ($p['lat'] - $origin['lat']) * self::DEG * self::R_EARTH,
        ];
    }

    /** Point reached travelling $distanceM metres from $origin on $bearingDeg. */
    public static function destinationPoint(array $origin, float $bearingDeg, float $distanceM): array
    {
        $latRad = $origin['lat'] * self::DEG;
        $east = sin($bearingDeg * self::DEG) * $distanceM;
        $north = cos($bearingDeg * self::DEG) * $distanceM;
        return [
            'lat' => $origin['lat'] + ($north / self::R_EARTH) / self::DEG,
            'lon' => $origin['lon'] + ($east / (self::R_EARTH * cos($latRad))) / self::DEG,
        ];
    }

    /** Initial great-circle bearing from $a to $b in degrees (0..360). */
    public static function bearing(array $a, array $b): float
    {
        $phi1 = $a['lat'] * self::DEG;
        $phi2 = $b['lat'] * self::DEG;
        $dLon = ($b['lon'] - $a['lon']) * self::DEG;
        $y = sin($dLon) * cos($phi2);
        $x = cos($phi1) * sin($phi2) - sin($phi1) * cos($phi2) * cos($dLon);
        return fmod((atan2($y, $x) / self::DEG) + 360.0, 360.0);
    }

    /** Smallest absolute difference between two bearings, in [0, 180]. */
    public static function angleDelta(float $a, float $b): float
    {
        $d = fmod(fmod($a - $b, 360.0) + 360.0, 360.0);
        return $d > 180.0 ? 360.0 - $d : $d;
    }

    /**
     * Project point $p onto segment $a→$b (all local metres). Returns crossTrack
     * (perpendicular distance to the infinite line), alongTrack (signed distance
     * of the foot from $a; 0 at $a, len at $b), and len.
     */
    public static function projectOntoSegment(array $p, array $a, array $b): array
    {
        $abx = $b['x'] - $a['x'];
        $aby = $b['y'] - $a['y'];
        $len = hypot($abx, $aby) ?: 1e-9;
        $ux = $abx / $len;
        $uy = $aby / $len;
        $apx = $p['x'] - $a['x'];
        $apy = $p['y'] - $a['y'];
        $alongTrack = $apx * $ux + $apy * $uy;
        $crossTrack = abs($apx * $uy - $apy * $ux);
        return ['crossTrack' => $crossTrack, 'alongTrack' => $alongTrack, 'len' => $len];
    }
}
