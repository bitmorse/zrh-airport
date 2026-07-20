<?php

declare(strict_types=1);

namespace Zrh;

/**
 * ADS-B ingestion: normalise the readsb / ADSBExchange-v2 aircraft.json shape
 * (ported from src/data/adsb.ts) and fetch a snapshot from the same no-key,
 * ADSBExchange-compatible providers the frontend uses, with failover.
 */
final class Adsb
{
    /** No-key providers, tried in order. */
    private const PROVIDERS = [
        ['name' => 'adsb.lol', 'tpl' => 'https://api.adsb.lol/v2/lat/%1$s/lon/%2$s/dist/%3$s'],
        ['name' => 'adsb.fi', 'tpl' => 'https://opendata.adsb.fi/api/v2/lat/%1$s/lon/%2$s/dist/%3$s'],
        ['name' => 'airplanes.live', 'tpl' => 'https://api.airplanes.live/v2/point/%1$s/%2$s/%3$s'],
    ];

    private const TIMEOUT_S = 8;

    /** @return array{aircraft: array<int,array>, provider: string, fetchedAt: int} */
    public static function fetchAircraftNear(array $center, float $distNm, ?string $preferred = null, ?callable $httpGet = null): array
    {
        $httpGet ??= [self::class, 'curlGet'];
        $providers = self::PROVIDERS;
        if ($preferred !== null) {
            usort($providers, static fn ($a, $b) => ($a['name'] === $preferred ? 0 : 1) <=> ($b['name'] === $preferred ? 0 : 1));
        }

        $errors = [];
        foreach ($providers as $p) {
            $url = sprintf($p['tpl'], $center['lat'], $center['lon'], $distNm);
            try {
                $body = $httpGet($url, self::TIMEOUT_S);
                if ($body === null) {
                    $errors[] = "{$p['name']}: no response";
                    continue;
                }
                $json = json_decode($body, true);
                $list = (is_array($json) && isset($json['ac']) && is_array($json['ac'])) ? $json['ac'] : [];
                $aircraft = [];
                foreach ($list as $raw) {
                    $ac = self::normalise($raw);
                    if ($ac !== null) {
                        $aircraft[] = $ac;
                    }
                }
                return ['aircraft' => $aircraft, 'provider' => $p['name'], 'fetchedAt' => self::nowMs()];
            } catch (\Throwable $e) {
                $errors[] = "{$p['name']}: {$e->getMessage()}";
            }
        }
        throw new \RuntimeException('All ADS-B providers failed — ' . implode('; ', $errors));
    }

    /** Normalise one raw aircraft.json entry; null if it lacks a usable position. */
    public static function normalise(array $raw): ?array
    {
        if (
            empty($raw['hex'])
            || !isset($raw['lat']) || !is_numeric($raw['lat'])
            || !isset($raw['lon']) || !is_numeric($raw['lon'])
        ) {
            return null;
        }

        $altBaro = $raw['alt_baro'] ?? null;
        $onGround = $altBaro === 'ground';

        return [
            'hex' => (string) $raw['hex'],
            'flight' => isset($raw['flight']) && trim((string) $raw['flight']) !== '' ? trim((string) $raw['flight']) : null,
            'lat' => (float) $raw['lat'],
            'lon' => (float) $raw['lon'],
            'altFt' => (!$onGround && is_numeric($altBaro)) ? 0 + $altBaro : null,
            'altGeomFt' => isset($raw['alt_geom']) && is_numeric($raw['alt_geom']) ? 0 + $raw['alt_geom'] : null,
            'onGround' => $onGround,
            'gs' => isset($raw['gs']) && is_numeric($raw['gs']) ? 0 + $raw['gs'] : null,
            'track' => isset($raw['track']) && is_numeric($raw['track']) ? 0 + $raw['track'] : null,
            'verticalRateFpm' => self::verticalRate($raw),
            'seenPos' => isset($raw['seen_pos']) && is_numeric($raw['seen_pos']) ? 0 + $raw['seen_pos'] : null,
            'type' => self::trimOrNull($raw['t'] ?? null),
            'typeDesc' => self::trimOrNull($raw['desc'] ?? null),
            'registration' => self::trimOrNull($raw['r'] ?? null),
        ];
    }

    private static function verticalRate(array $raw): int|float|null
    {
        if (isset($raw['baro_rate']) && is_numeric($raw['baro_rate'])) {
            return 0 + $raw['baro_rate'];
        }
        if (isset($raw['geom_rate']) && is_numeric($raw['geom_rate'])) {
            return 0 + $raw['geom_rate'];
        }
        return null;
    }

    private static function trimOrNull(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $t = trim((string) $v);
        return $t === '' ? null : $t;
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

    private static function nowMs(): int
    {
        return (int) (microtime(true) * 1000);
    }
}
