package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Bounds how often one household can ask us to talk to Stripe. A sibling of ContactRateLimiter and
// RegistrationRateLimiter rather than an extension of either -- separate buckets, so a burst of
// checkout attempts cannot lock anyone out of registering or reporting a bug, and vice versa.
//
// Per-ACCOUNT only, no global bucket, and that asymmetry is deliberate. The other two limiters
// bound a shared, metered resource (outbound email spend), where one abuser really can deny the
// channel to everyone. Stripe API calls have no such shared ceiling, so a global bucket here would
// buy nothing while creating a way for one person to block every OTHER household from paying --
// which is a self-inflicted outage on the one endpoint that makes money.
//
// The endpoint is authenticated, so there is a stable identity to bucket on that an attacker cannot
// rotate without first creating another confirmed account.
@Component
public class BillingRateLimiter {

    // Generous for a real person: a few taps, a declined card, a retry with a different card. Well
    // short of anything that would run up Stripe API volume.
    private static final int PER_ACCOUNT_PER_HOUR = 20;

    private final ClockTimeMeter timeMeter;
    private final Cache<Long, Bucket> perAccountBuckets;

    public BillingRateLimiter(Clock clock) {
        this.timeMeter = new ClockTimeMeter(clock);
        this.perAccountBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
    }

    public boolean tryConsumePerAccount(Long accountId) {
        Bucket bucket = perAccountBuckets.get(accountId, key -> newBucket());
        return bucket.tryConsume(1);
    }

    private Bucket newBucket() {
        return Bucket.builder()
                .withCustomTimePrecision(timeMeter)
                .addLimit(limit -> limit.capacity(PER_ACCOUNT_PER_HOUR)
                        .refillGreedy(PER_ACCOUNT_PER_HOUR, Duration.ofHours(1)))
                .build();
    }
}
