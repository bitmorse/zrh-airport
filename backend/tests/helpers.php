<?php

declare(strict_types=1);

/** Shared test helpers, loaded before any *Test.php. */

/** Epoch ms for a wall-clock time in a given zone. */
function tsAt(string $when, string $tz): int
{
    return (new DateTimeImmutable($when, new DateTimeZone($tz)))->getTimestamp() * 1000;
}
