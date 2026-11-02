package com.worktrac.backend.membership;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.SubscriptionService;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

// "Is this token still valid, and what may it do in this account?" -- resolved once per request
// and cached. The direct successor to TokenVersionService, which answered only the first half.
//
// ⚠️ THE CACHE IS THE WHOLE POINT, not an optimisation bolted on afterwards. This is consulted on
// EVERY authenticated request, so the obvious implementation -- read the membership each time --
// would add a database round trip to the hottest path in the app, and would acquire its own
// connection outside the request's transaction. With a Hikari pool of 10, that is a meaningful
// step toward the pool-exhaustion behaviour docs/architecture/resilience.md describes, where
// requests queue past the client's 15s abort and the app reports itself as lie-fi. Paying that on
// every set logged, to catch something that happens perhaps once in an account's lifetime, is the
// wrong trade.
//
// The 60-second TTL is what that buys. It is now only the backstop, because the backend runs as
// several replicas and each has its own copy of this cache:
//
//   * An invalidation clears this replica's cache at once, and is written to access_invalidations
//     (AccessInvalidationLog), which every replica replays every ~2s (AccessInvalidationPoller). So
//     a revocation, a plan change or a visibility setting reaches every replica in about two
//     seconds -- and if that table is unreachable, in at most the 60s TTL, as before.
//
//   * A token NEWER than the cached entry re-reads instead of being refused (isOlderThan). Two
//     seconds is fine for a revocation, but not for the request carrying a freshly minted token:
//     change your password on replica A, and the very next request -- with the new token -- may land
//     on replica B, whose cache still holds the old version. Refusing it would answer 401, and the
//     client reads any 401 as "signed out". Same for an invite just accepted: B may have cached "no
//     membership". A token that is OLDER than the cache is still refused without a read, so a
//     revoked device retrying forever costs nothing.
//
// ── WHY THE ROLE IS RESOLVED HERE AND NOT CARRIED IN THE TOKEN ────────────────────────────────
// Widening this lookup rather than adding an accountRole claim costs nothing (same query count,
// same round trips as the token-version check it replaces) and buys three things a claim cannot:
// removing a membership takes effect within seconds instead of 30 days; a role change likewise; and
// there is no "what does an absent claim mean" question, whose only natural-looking answer
// (OWNER) fails open. See AccountAccess's header.
@Service
public class AccountAccessService {

    private record AccessKey(Long userId, Long accountId) {
    }

    private final AccountMembershipRepository membershipRepository;
    private final SubscriptionService subscriptionService;
    private final AccessInvalidationLog invalidationLog;
    private final Clock clock;

    // A negative result (no membership) is cached as an empty Optional rather than not cached at
    // all: a revoked login whose device keeps retrying must not turn into a database read per
    // request. `loadedAt` is what lets a token minted AFTER that negative result was read (an
    // invite accepted on another replica) re-read instead -- see isOlderThan.
    private final Cache<AccessKey, Entry> rows = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(60))
            .maximumSize(10_000)
            .build();

    /**
     * The membership row plus the household's plan.
     *
     * <p>⚠️ <b>{@code accountPlan} is cached HERE rather than resolved per request, and that is
     * the whole reason this record exists.</b> {@code SubscriptionService.entitledPlan} is a
     * database read, and phase 8 needs the answer on EVERY request — {@code PermissionInterceptor} asks whether a
     * member is paused before it asks anything else. Calling it from {@code resolve()} would add a
     * query per request to the app's hottest path and undo exactly what this cache is for.
     *
     * <p>Cached, it costs one extra read per cache MISS (so at most one a minute per login), and
     * nothing on a hit. The staleness that buys is bounded by the same 60s TTL as the membership
     * itself, and {@code invalidateAccount} makes a real plan change take effect immediately —
     * see {@code AccountPlanChangedListener} for what calls it.
     */
    private record CachedAccess(AccountAccessRow row, SubscriptionService.Entitlement entitlement) {
    }

    private record Entry(Optional<CachedAccess> access, Instant loadedAt) {
    }

    public AccountAccessService(AccountMembershipRepository membershipRepository,
                                 SubscriptionService subscriptionService,
                                 AccessInvalidationLog invalidationLog, Clock clock) {
        this.membershipRepository = membershipRepository;
        this.subscriptionService = subscriptionService;
        this.invalidationLog = invalidationLog;
        this.clock = clock;
    }

    /**
     * The access this token has, or empty if it has none.
     *
     * <p>Empty covers three cases that the caller must treat identically, because all three mean
     * "this token is no longer usable": the membership never existed, it has been revoked, or the
     * token's version no longer matches the user's (a password reset). Leaving the SecurityContext
     * unset falls through to the 401 the client already handles as an expired session.
     */
    public Optional<AccountAccess> resolve(Long userId, Long accountId, int tokenVersion) {
        return resolve(userId, accountId, tokenVersion, null);
    }

    /**
     * As {@link #resolve(Long, Long, int)}, for a token whose {@code iat} is known. That is what lets
     * a token minted after the cached entry was read re-read it, instead of being refused by a
     * replica that has not caught up yet. See this class's header.
     */
    public Optional<AccountAccess> resolve(Long userId, Long accountId, int tokenVersion, Instant issuedAt) {
        AccessKey key = new AccessKey(userId, accountId);
        Entry entry = rows.get(key, this::load);
        if (isOlderThan(entry, tokenVersion, issuedAt)) {
            entry = load(key);
            rows.put(key, entry);
        }

        return entry.access().filter(c -> c.row().tokenVersion() == tokenVersion)
                .map(c -> new AccountAccess(c.row().userId(), c.row().accountId(),
                        c.row().membershipId(), c.row().accountRole(), c.row().personId(),
                        c.row().membersSeeEveryone(), c.entitlement().plan(),
                        c.entitlement().clientSeats()));
    }

    private Entry load(AccessKey key) {
        Instant loadedAt = clock.instant();
        return new Entry(membershipRepository.findAccessRow(key.userId(), key.accountId())
                // Resolved on the miss, inside the loader, so a hit stays a pure memory read. See
                // CachedAccess.
                .map(r -> new CachedAccess(r, subscriptionService.entitlementOf(r.accountId()))),
                loadedAt);
    }

    /**
     * True when the token proves the cached entry is out of date, so it must be re-read rather than
     * used to refuse the token.
     *
     * <ul>
     *   <li>A membership is cached and the token carries a HIGHER version: the version was bumped
     *       (a password change) after this entry was read. A LOWER version is a genuinely stale
     *       token and is refused without a read.</li>
     *   <li>No membership is cached and the token was issued no earlier than that was read: the
     *       membership was created after (an invite accepted elsewhere). A token issued before is
     *       an old one being retried and is refused without a read. {@code iat} has whole-second
     *       precision, so the comparison is against the second the entry was read in -- a token
     *       minted in that same second re-reads, which costs at most a few reads.</li>
     * </ul>
     */
    private static boolean isOlderThan(Entry entry, int tokenVersion, Instant issuedAt) {
        if (entry.access().isPresent()) {
            return tokenVersion > entry.access().get().row().tokenVersion();
        }
        return issuedAt != null && !issuedAt.isBefore(entry.loadedAt().truncatedTo(ChronoUnit.SECONDS));
    }

    /** After a membership is created, removed, or has its role or person changed. */
    public void invalidate(Long userId, Long accountId) {
        evictLocally(userId, accountId);
        invalidationLog.record(userId, accountId);
    }

    /**
     * After a token-version bump (password reset) or an account deletion — every household this
     * login belongs to, since the credential itself changed.
     *
     * <p>A key scan rather than a side index. A {@code Map<userId, Set<accountId>>} kept beside a
     * cache with its own eviction policy is a second source of truth that can drift out of step
     * with it, and this runs a handful of times a day against at most 10 000 keys.
     */
    public void invalidateUser(Long userId) {
        evictLocally(userId, null);
        invalidationLog.record(userId, null);
    }

    /**
     * After anything account-wide changes what its members may do — phase 3's visibility setting,
     * and now the household's PLAN.
     *
     * <p>⚠️ Without this a downgrade would take up to 60s to bite and, far worse, a RE-UPGRADE
     * would take up to 60s to lift: somebody who has just paid would keep seeing the paused screen
     * with no way to tell whether it worked. {@code AccountPlanChangedListener} is what calls it.
     */
    public void invalidateAccount(Long accountId) {
        evictLocally(null, accountId);
        invalidationLog.record(null, accountId);
    }

    /**
     * Evicts from THIS replica's cache only, at the scope the non-null ids describe. What
     * {@link AccessInvalidationPoller} calls for every replayed row -- including this replica's own,
     * which is what closes the gap where a request reloads between the eviction above and the commit
     * of the change that caused it.
     */
    void evictLocally(Long userId, Long accountId) {
        if (userId != null && accountId != null) {
            rows.invalidate(new AccessKey(userId, accountId));
        } else if (userId != null) {
            rows.asMap().keySet().removeIf(key -> key.userId().equals(userId));
        } else if (accountId != null) {
            rows.asMap().keySet().removeIf(key -> key.accountId().equals(accountId));
        }
    }
}
