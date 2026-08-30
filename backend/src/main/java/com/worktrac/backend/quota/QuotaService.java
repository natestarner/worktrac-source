package com.worktrac.backend.quota;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.worktrac.backend.common.ForbiddenException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;

// The one place a per-household ceiling is enforced, and the one place a breach is reported.
//
// ── WHY 403 AND NOT 429 ────────────────────────────────────────────────────────────────────────
// This is a durability decision, not a cosmetic one. shouldRetryWrite treats 429 as TRANSIENT and
// retries it, but a quota does not clear on its own -- so a 429 here would make a durable write
// replay against a ceiling that will never move: a poison message, exactly the failure the @Size
// caps were added to remove. 403 is terminal, which is the honest answer to "you cannot have more
// of this". The one genuinely time-bounded limit, imports-per-hour, DOES use 429, and it lives in
// ImportRateLimiter rather than here for precisely that reason.
//
// ── VISIBILITY IS HALF THE FEATURE ─────────────────────────────────────────────────────────────
// A quota nobody can see is a support ticket waiting to happen: the household hits a wall, writes
// in saying "it's broken", and nothing in the logs says why. So every breach logs at WARN with the
// quota name, the account, the current count and the limit -- and those lines already carry `cid`
// and `uid` in the MDC from RequestDiagnosticsFilter and JwtAuthenticationFilter, so a breach is
// traceable to the exact session without any extra plumbing.
//
// It also warns at 80%, once per account per quota per hour, so a household APPROACHING a ceiling
// shows up before they hit it. That is the line that turns a quota from a surprise into something
// visible in advance. The suppression map is Caffeine-backed and evicts on idle, so it cannot grow
// without bound.
//
// The KQL for reading both out of Log Analytics is in docs/azure-read-only-access.md.
@Service
public class QuotaService {

    private static final Logger log = LoggerFactory.getLogger(QuotaService.class);

    private static final double WARN_AT = 0.8;

    private final QuotaProperties properties;

    // One entry per (quota, scope) that has already warned recently. Value is unused -- presence
    // is the whole signal.
    private final Cache<String, Boolean> recentlyWarned = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofHours(1))
            .maximumSize(10_000)
            .build();

    public QuotaService(QuotaProperties properties) {
        this.properties = properties;
    }

    public void requirePersonCapacity(Long accountId, long currentCount) {
        check("people-per-account", accountId, currentCount, properties.getPeoplePerAccount(),
                "This household has reached its limit of %d people.");
    }

    public void requireExerciseCapacity(Long accountId, long currentCount) {
        check("exercises-per-account", accountId, currentCount, properties.getExercisesPerAccount(),
                "This household has reached its limit of %d of its own exercises.");
    }

    public void requireTagCapacity(Long accountId, long currentCount) {
        check("tags-per-account", accountId, currentCount, properties.getTagsPerAccount(),
                "This household has reached its limit of %d tags.");
    }

    public void requireRoutineCapacity(Long accountId, Long personId, long currentCount) {
        check("routines-per-person", accountId, personId, currentCount, properties.getRoutinesPerPerson(),
                "This person has reached their limit of %d routines.");
    }

    public void requireCustomFieldCapacity(Long accountId, long currentCount) {
        check("custom-fields-per-exercise", accountId, currentCount, properties.getCustomFieldsPerExercise(),
                "This exercise has reached its limit of %d setup fields.");
    }

    // Deliberately NOT called when logging a set, only when importing.
    //
    // Two reasons, and the second is the important one. First, a person logging sets by hand is
    // bounded by physiology -- a hundred a day is a lot -- so it is not the vector; import is,
    // because it inserts thousands in one request. Second, logging a set is a DURABLE write, so a
    // 403 would silently discard a set that may have sat in the outbox through an entire outage.
    // Refusing to record a workout somebody actually did, because of a ceiling they cannot see
    // mid-set, is a worse outcome than the storage it consumes.
    //
    // `incoming` is the number of rows the import is about to add, so a single file cannot vault
    // over the ceiling in one transaction the way a per-row check would allow.
    public void requireSetCapacity(Long accountId, long currentCount, long incoming) {
        long limit = properties.getSetsPerAccount();
        if (currentCount + incoming > limit) {
            log.warn("Quota exceeded: quota=sets-per-account accountId={} current={} incoming={} limit={}",
                    accountId, currentCount, incoming, limit);
            throw new ForbiddenException(String.format(
                    "This import would put the household over its limit of %d recorded sets.", limit));
        }
        warnIfApproaching("sets-per-account", accountId, String.valueOf(accountId), currentCount + incoming, limit);
    }

    private void check(String quota, Long accountId, long currentCount, int limit, String message) {
        check(quota, accountId, null, currentCount, limit, message);
    }

    private void check(String quota, Long accountId, Long personId, long currentCount, int limit, String message) {
        String scope = personId == null ? String.valueOf(accountId) : accountId + ":" + personId;
        if (currentCount >= limit) {
            log.warn("Quota exceeded: quota={} accountId={} personId={} current={} limit={}",
                    quota, accountId, personId, currentCount, limit);
            throw new ForbiddenException(String.format(message, limit));
        }
        warnIfApproaching(quota, accountId, scope, currentCount, limit);
    }

    // Fires once per hour per scope. Without the suppression this would log on EVERY write once a
    // household is near a ceiling, which buries the signal in the noise it creates.
    private void warnIfApproaching(String quota, Long accountId, String scope, long currentCount, long limit) {
        if (currentCount < limit * WARN_AT) {
            return;
        }
        String key = quota + "/" + scope;
        if (recentlyWarned.getIfPresent(key) != null) {
            return;
        }
        recentlyWarned.put(key, Boolean.TRUE);
        log.warn("Quota approaching: quota={} accountId={} current={} limit={} ({}% used)",
                quota, accountId, currentCount, limit, Math.round(100.0 * currentCount / limit));
    }
}
