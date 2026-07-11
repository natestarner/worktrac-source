package com.worktrac.backend.ratelimit;

import io.github.bucket4j.TimeMeter;

import java.time.Clock;
import java.time.Instant;

// Adapts the app's injected Clock bean (ClockConfig) to Bucket4j's TimeMeter, so rate-limit
// windows advance with the same MutableClock used for expiry tests elsewhere
// (WorkoutSetService, RestSecondsTest) instead of becoming an untestable island tied to
// wall-clock time.
class ClockTimeMeter implements TimeMeter {

    private final Clock clock;

    ClockTimeMeter(Clock clock) {
        this.clock = clock;
    }

    @Override
    public long currentTimeNanos() {
        Instant now = clock.instant();
        return now.getEpochSecond() * 1_000_000_000L + now.getNano();
    }

    @Override
    public boolean isWallClockBased() {
        // The injected Clock always represents wall-clock time -- Clock.systemUTC() in
        // production, MutableClock (a manually-advanced stand-in for wall-clock time,
        // not a monotonic source) in tests.
        return true;
    }
}
