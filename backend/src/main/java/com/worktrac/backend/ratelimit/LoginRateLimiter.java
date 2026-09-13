package com.worktrac.backend.ratelimit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// Rate limiting for POST /api/auth/login, which previously had none at all. A sibling of
// RegistrationRateLimiter and ContactRateLimiter rather than an extension of either: those two
// bound EMAIL SPEND (a hit costs a real Azure Communication Services send), while this one bounds
// GUESSING and CPU. Sharing their buckets would mean a login flood could lock people out of
// registering, and vice versa.
//
// Two things it defends, and they are genuinely different:
//
//   - Guessing at ONE account, from anywhere. That is the per-EMAIL bucket, the narrowest of the
//     three. The per-account lockout in AuthService is stronger still, but it is defeated by
//     spreading attempts thinly; and a per-IP bound alone gave an attacker on 60 IPs sixty times
//     the budget against a single address. ⚠️ This bucket is consumed for every submitted address
//     whether or not an account exists -- consuming it only for known emails would make "which
//     addresses eventually 429" a user-enumeration oracle, reintroducing through the limiter
//     exactly what DUMMY_HASH closed in the response.
//   - Credential stuffing from one source. The per-account lockout in AuthService is the stronger
//     answer to guessing, but it is per account: an attacker spraying one common password across
//     many accounts never trips it. The per-IP bucket is what bounds that shape.
//   - CPU exhaustion. Every login attempt costs a BCrypt verification, roughly 100ms of CPU, so
//     on the order of ten requests a second saturates a full vCPU. This is consumed BEFORE the
//     user lookup and before any BCrypt work, so a flood is refused without paying for it --
//     which is the whole point and is why the ordering in AuthService.login must not change.
//
// The global bucket is a backstop against a distributed attempt that rotates source IPs, sized far
// above any plausible real total so it only ever engages under genuine attack.
@Component
public class LoginRateLimiter {

    private final RateLimitProperties properties;
    private final ClockTimeMeter timeMeter;
    private final Bucket globalBucket;
    private final Cache<String, Bucket> perIpBuckets;
    private final Cache<String, Bucket> perEmailBuckets;

    public LoginRateLimiter(RateLimitProperties properties, Clock clock) {
        this.properties = properties;
        this.timeMeter = new ClockTimeMeter(clock);
        this.globalBucket = newBucket(properties.getLoginGlobalPerHour());
        // Evicts on idle, so this map cannot grow without bound the way a hand-rolled HashMap would.
        this.perIpBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .build();
        // Same bounded shape as the per-IP map. It is keyed on a SUBMITTED string rather than a
        // known account, so an attacker can grow it at will -- expireAfterAccess plus a maximumSize
        // is what keeps that from being a memory-exhaustion vector in its own right.
        this.perEmailBuckets = Caffeine.newBuilder()
                .expireAfterAccess(Duration.ofHours(1))
                .maximumSize(50_000)
                .build();
    }

    /**
     * The narrowest bucket: attempts against one address, from anywhere.
     *
     * <p>⚠️ <b>Call this for every submitted address, including one with no account.</b> Skipping
     * it for unknown emails turns "which addresses eventually 429" into a user-enumeration oracle.
     * The caller must also normalise the address the same way the lookup does, or
     * {@code Nate@x.com} and {@code nate@x.com} get a budget each.
     */
    public boolean tryConsumePerEmail(String email) {
        Bucket bucket = perEmailBuckets.get(email, key -> newBucket(properties.getLoginPerEmailPerHour()));
        return bucket.tryConsume(1);
    }

    public boolean tryConsumePerIp(String ipAddress) {
        Bucket bucket = perIpBuckets.get(ipAddress, key -> newBucket(properties.getLoginPerIpPerHour()));
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
