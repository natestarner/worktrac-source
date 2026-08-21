package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Rate limiting for the in-app Contact Us form. A sibling of RegistrationRateLimiter rather than an
// extension of it: the two guard different things (that one bounds verification-email cost for
// ANONYMOUS callers, this one bounds an authenticated household member's submissions), and sharing
// buckets would mean a burst of contact messages could lock somebody out of registering.
//
// Three layers, and the ORDER they are consumed in is deliberate -- narrowest first:
//   - per-user, the real defense here. Unlike registration, this endpoint is authenticated, so
//     there is a stable identity to bucket on that an attacker cannot rotate without first
//     creating another confirmed account.
//   - per-IP, which catches one person cycling accounts from the same device.
//   - global, which bounds total admin-alert email spend the same way
//     RegistrationRateLimiter's global bucket bounds verification sends.
// Checking per-user FIRST means a single abuser exhausts only their own bucket; if the global
// bucket were consumed first, one person could deny the alert channel to everybody else before
// their own limit ever tripped.
//
// Both Caffeine caches evict on idle, so neither map grows without bound the way a hand-rolled
// HashMap would.
@Component
public class ContactRateLimiter {

    private final RateLimitProperties properties;
    private final ClockTimeMeter timeMeter;
    private final Bucket globalBucket;
    private final Cache<Long, Bucket> perUserBuckets;
    private final Cache<String, Bucket> perIpBuckets;

    public ContactRateLimiter(RateLimitProperties properties, Clock clock) {
        this.properties = properties;
        this.timeMeter = new ClockTimeMeter(clock);
        this.globalBucket = newBucket(properties.getContactGlobalPerHour());
        this.perUserBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
        this.perIpBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
    }

    public boolean tryConsumePerUser(Long userId) {
        Bucket bucket = perUserBuckets.get(userId, key -> newBucket(properties.getContactPerUserPerHour()));
        return bucket.tryConsume(1);
    }

    public boolean tryConsumePerIp(String ipAddress) {
        Bucket bucket = perIpBuckets.get(ipAddress, key -> newBucket(properties.getContactPerIpPerHour()));
        return bucket.tryConsume(1);
    }

    public boolean tryConsumeGlobal() {
        return globalBucket.tryConsume(1);
    }

    private Bucket newBucket(int perHour) {
        return Bucket.builder()
                .withCustomTimePrecision(timeMeter)
                .addLimit(limit -> limit.capacity(perHour).refillGreedy(perHour, Duration.ofHours(1)))
                .build();
    }
}
