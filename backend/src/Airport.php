<?php

declare(strict_types=1);

namespace Zrh;

/**
 * Airport geometry, derived from a hand-authored config (config/airports.json,
 * itself ported from the frontend's src/data/airports.ts). Mirrors
 * src/domain/airport.ts buildAirport: each physical runway yields two opposing
 * ends, each carrying its threshold, far-end, bearing-of-travel and a centreline
 * pre-projected to local metres around the ARP.
 *
 * Each derived end is an array:
 *   ['id','opposite','strip','threshold'=>LatLon,'farEnd'=>LatLon,
 *    'bearingDeg','a'=>Vec2,'b'=>Vec2,'len']
 */
final class Airport
{
    public string $icao = '';
    public string $iata = '';
    public string $name = '';
    public array $arp = ['lat' => 0.0, 'lon' => 0.0];
    public float $fieldElevationFt = 0.0;
    public float $geoidFt = 0.0;
    public ?string $timeZone = null;
    /** @var array<int,array> */
    public array $ends = [];

    public static function fromConfig(array $cfg): self
    {
        $a = new self();
        $a->icao = (string) $cfg['icao'];
        $a->iata = (string) ($cfg['iata'] ?? '');
        $a->name = (string) ($cfg['name'] ?? '');
        $a->arp = ['lat' => (float) $cfg['arp']['lat'], 'lon' => (float) $cfg['arp']['lon']];
        $a->fieldElevationFt = (float) ($cfg['fieldElevationFt'] ?? 0.0);
        $a->geoidFt = (float) ($cfg['geoidFt'] ?? 0.0);
        $a->timeZone = isset($cfg['timeZone']) ? (string) $cfg['timeZone'] : null;

        foreach ($cfg['runways'] as $rw) {
            [$e0, $e1] = $rw['ends'];
            $t0 = ['lat' => (float) $e0['threshold']['lat'], 'lon' => (float) $e0['threshold']['lon']];
            $t1 = ['lat' => (float) $e1['threshold']['lat'], 'lon' => (float) $e1['threshold']['lon']];
            $strip = "{$e0['id']}/{$e1['id']}";
            $a->ends[] = $a->makeEnd((string) $e0['id'], (string) $e1['id'], $strip, $t0, $t1);
            $a->ends[] = $a->makeEnd((string) $e1['id'], (string) $e0['id'], $strip, $t1, $t0);
        }

        return $a;
    }

    public static function load(string $icao, string $configPath): self
    {
        $json = file_get_contents($configPath);
        if ($json === false) {
            throw new \RuntimeException("cannot read airport config: {$configPath}");
        }
        $all = json_decode($json, true);
        if (!is_array($all) || !isset($all[$icao])) {
            throw new \RuntimeException("unknown airport: {$icao}");
        }
        return self::fromConfig($all[$icao]);
    }

    private function makeEnd(string $id, string $opposite, string $strip, array $threshold, array $farEnd): array
    {
        $a = Geo::toLocalMeters($this->arp, $threshold);
        $b = Geo::toLocalMeters($this->arp, $farEnd);
        return [
            'id' => $id,
            'opposite' => $opposite,
            'strip' => $strip,
            'threshold' => $threshold,
            'farEnd' => $farEnd,
            'bearingDeg' => Geo::bearing($threshold, $farEnd),
            'a' => $a,
            'b' => $b,
            'len' => hypot($b['x'] - $a['x'], $b['y'] - $a['y']),
        ];
    }
}
