package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Bounds how often one household can run an import. A sibling of BillingRateLimiter in shape and
// for the same reasons: per-ACCOUNT only, no global bucket (importing consumes this household's own
// storage, not a shared metered resource, so a global bucket would only create a way for one person
// to block everyone else), and authenticated, so there is a stable identity to bucket on.
//
// This is the one limit in the import path expressed as a RATE rather than a quota, and the
// distinction is deliberate: QuotaService's ceilings do not clear on their own, so they answer 403
// (terminal). This one genuinely does clear with time, so 429 is honest -- and 429 is in
// shouldRetryWrite's RETRYABLE_4XX set, which is exactly right for a limit that will lift.
//
// A single import is already bounded at 20,000 rows and 5 MB by CsvImportParser, so five an hour
// still allows 100,000 rows an hour -- far beyond any real backfill, while stopping an account from
// looping the endpoint to inflate the database.
@Component
public class ImportRateLimiter {

    private static final int PER_ACCOUNT_PER_HOUR = 5;

    private final ClockTimeMeter timeMeter;
    private final Cache<Long, Bucket> perAccountBuckets;

    public ImportRateLimiter(Clock clock) {
        this.timeMeter = new ClockTimeMeter(clock);
        // Evicts on idle, so this map cannot grow without bound.
        this.perAccountBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
    }

    public boolean tryConsumePerAccount(Long accountId) {
        Bucket bucket = perAccountBuckets.get(accountId, key -> Bucket.builder()
                .withCustomTimePrecision(timeMeter)
                .addLimit(limit -> limit.capacity(PER_ACCOUNT_PER_HOUR)
                        .refillGreedy(PER_ACCOUNT_PER_HOUR, Duration.ofHours(1)))
                .build());
        return bucket.tryConsume(1);
    }
}
