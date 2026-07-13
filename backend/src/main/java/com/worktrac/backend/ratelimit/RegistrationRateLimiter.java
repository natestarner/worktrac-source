package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Rate limiting for registration/resend-code abuse. Two independent layers:
//   - a global bucket bounding total verification emails sent system-wide (the real defense
//     against a distributed bot running up the Azure Communication Services bill -- per-IP
//     limits alone don't help against a bot that rotates source IPs or target emails)
//   - a per-IP bucket (evicted automatically by Caffeine once idle, so this can't grow
//     without bound the way a hand-rolled map would)
// The per-email cooldown/cap is deliberately not here -- it's persisted directly on the
// pending_registrations row (RegistrationService), since it needs to survive restarts and is
// scoped to one specific pending registration rather than being a general abuse control.
@Component
public class RegistrationRateLimiter {

    private final RateLimitProperties properties;
    private final ClockTimeMeter timeMeter;
    private final Bucket globalBucket;
    private final Cache<String, Bucket> perIpBuckets;

    public RegistrationRateLimiter(RateLimitProperties properties, Clock clock) {
        this.properties = properties;
        this.timeMeter = new ClockTimeMeter(clock);
        this.globalBucket = newBucket(properties.getGlobalEmailSendsPerHour());
        this.perIpBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
    }

    public boolean tryConsumeGlobal() {
        return globalBucket.tryConsume(1);
    }

    public boolean tryConsumePerIp(String ipAddress) {
        Bucket bucket = perIpBuckets.get(ipAddress, key -> newBucket(properties.getPerIpPerHour()));
        return bucket.tryConsume(1);
    }

    private Bucket newBucket(int perHour) {
        return Bucket.builder()
                .withCustomTimePrecision(timeMeter)
                .addLimit(limit -> limit.capacity(perHour).refillGreedy(perHour, Duration.ofHours(1)))
                .build();
    }
}
