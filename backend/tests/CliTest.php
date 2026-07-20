<?php

declare(strict_types=1);

use Zrh\Cli;

/**
 * Collector CLI argument parsing. Supports single-shot (default) and a
 * self-looping mode so one cron kick can poll continuously between ticks:
 *   collect.php LSZH
 *   collect.php --loop 540 --every 30 LSZH VTBS
 */
return [
    'default: one airport, no loop' => function (): void {
        $a = Cli::parseArgs(['collect.php']);
        Assert::same(['LSZH'], $a['icaos']);
        Assert::same(0, $a['loopSeconds'], 'no loop by default');
    },

    'positional airports, uppercased' => function (): void {
        $a = Cli::parseArgs(['collect.php', 'lszh', 'VTBS']);
        Assert::same(['LSZH', 'VTBS'], $a['icaos']);
    },

    'loop and every as separate tokens' => function (): void {
        $a = Cli::parseArgs(['collect.php', '--loop', '540', '--every', '30', 'LSZH']);
        Assert::same(540, $a['loopSeconds']);
        Assert::same(30, $a['everySeconds']);
        Assert::same(['LSZH'], $a['icaos']);
    },

    'loop and every as = form' => function (): void {
        $a = Cli::parseArgs(['collect.php', '--loop=300', '--every=20', 'LSZH']);
        Assert::same(300, $a['loopSeconds']);
        Assert::same(20, $a['everySeconds']);
    },

    'every has a sane floor' => function (): void {
        $a = Cli::parseArgs(['collect.php', '--every', '1', 'LSZH']);
        Assert::true($a['everySeconds'] >= 5, 'every clamped up to >=5s');
    },

    'default interval when only --loop given' => function (): void {
        $a = Cli::parseArgs(['collect.php', '--loop', '540', 'LSZH']);
        Assert::same(30, $a['everySeconds'], 'default 30s interval');
    },
];
