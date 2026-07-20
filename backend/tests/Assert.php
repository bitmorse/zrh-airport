<?php

declare(strict_types=1);

/**
 * Zero-dependency assertion helpers for the backend test suite. Kept tiny and
 * framework-free on purpose: the collector runs on NearlyFreeSpeech shared PHP
 * hosting where Composer/PHPUnit aren't available, so the tests must run with a
 * bare `php` interpreter.
 */
final class Assert
{
    public static int $count = 0;

    public static function true(bool $cond, string $msg = ''): void
    {
        self::$count++;
        if (!$cond) {
            throw new AssertionError($msg !== '' ? $msg : 'expected true, got false');
        }
    }

    public static function false(bool $cond, string $msg = ''): void
    {
        self::true(!$cond, $msg !== '' ? $msg : 'expected false, got true');
    }

    /** Strict equality for scalars/arrays. */
    public static function same(mixed $expected, mixed $actual, string $msg = ''): void
    {
        self::$count++;
        if ($expected !== $actual) {
            throw new AssertionError(
                ($msg !== '' ? $msg . ' — ' : '') .
                'expected ' . self::show($expected) . ', got ' . self::show($actual)
            );
        }
    }

    /** Float equality within an absolute tolerance. */
    public static function near(float $expected, float $actual, float $eps = 1e-6, string $msg = ''): void
    {
        self::$count++;
        if (abs($expected - $actual) > $eps) {
            throw new AssertionError(
                ($msg !== '' ? $msg . ' — ' : '') .
                "expected ~{$expected} (±{$eps}), got {$actual}"
            );
        }
    }

    public static function count(int $expected, array $arr, string $msg = ''): void
    {
        self::same($expected, count($arr), $msg !== '' ? $msg : 'array count');
    }

    private static function show(mixed $v): string
    {
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_array($v)) {
            return json_encode($v, JSON_UNESCAPED_SLASHES) ?: 'array';
        }
        if ($v === null) {
            return 'null';
        }
        return (string) $v;
    }
}
