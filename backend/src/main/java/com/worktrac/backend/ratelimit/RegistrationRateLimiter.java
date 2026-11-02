package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Rate limiting for registration/resend-code (and password-reset) abuse. Two independent layers:
//   - the global email cap (GlobalEmailCap): total user-facing emails queued system-wide, counted
//     from the outbox so it is ONE number across every replica. The real defense against a
//     distributed bot running up the Azure Communication Services bill -- per-IP limits alone
//     don't help against a bot that rotates source IPs or target emails.
//   - a per-IP bucket (evicted automatically by Caffeine once idle, so this can't grow without
//     bound the way a hand-rolled map would). In memory, so it applies PER REPLICA, deliberately:
//     docs/architecture/scaling.md explains why that is acceptable for the per-IP layer.
// The per-email cooldown/cap is deliberately not here -- it's persisted directly on the
// pending_registrations row (RegistrationService), since it needs to survive restarts and is
// scoped to one specific pending registration rather than being a general abuse control.
@Component
public class RegistrationRateLimiter {

    private final RateLimitProperties properties;
    private final ClockTimeMeter timeMeter;
    private final GlobalEmailCap globalEmailCap;
    private final Cache<String, Bucket> perIpBuckets;

    public RegistrationRateLimiter(RateLimitProperties properties, Clock clock, GlobalEmailCap globalEmailCap) {
        this.properties = properties;
        this.timeMeter = new ClockTimeMeter(clock);
        this.globalEmailCap = globalEmailCap;
        this.perIpBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
    }

    public boolean tryConsumeGlobal() {
        return globalEmailCap.tryAllow();
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
