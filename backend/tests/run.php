<?php

declare(strict_types=1);

/**
 * Tiny test runner. Each `*Test.php` file in this directory returns an
 * `array<string, callable>` mapping a test name to a closure that throws on
 * failure (via the Assert helpers). Run with: `php backend/tests/run.php`.
 */

require __DIR__ . '/Assert.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/../src/bootstrap.php';

$files = glob(__DIR__ . '/*Test.php') ?: [];
sort($files);

$passed = 0;
$failures = [];

foreach ($files as $file) {
    /** @var array<string, callable> $tests */
    $tests = require $file;
    $suite = basename($file, '.php');
    foreach ($tests as $name => $fn) {
        try {
            $fn();
            $passed++;
        } catch (\Throwable $e) {
            $failures[] = sprintf('%s › %s: %s', $suite, $name, $e->getMessage());
        }
    }
}

echo "\n";
foreach ($failures as $f) {
    echo "  ✗ {$f}\n";
}

$failCount = count($failures);
echo sprintf(
    "\n%s  %d passed, %d failed  (%d assertions)\n",
    $failCount === 0 ? '✓ GREEN' : '✗ RED',
    $passed,
    $failCount,
    Assert::$count
);

exit($failCount === 0 ? 0 : 1);
