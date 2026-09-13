package com.worktrac.backend.membership;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.worktrac.backend.billing.SubscriptionService;
import org.springframework.stereotype.Service;

import java.time.Duration;
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
// The 60-second TTL is what that buys, and the cost is bounded and stated: an invalidation takes
// effect immediately on the replica that made it, and within a minute everywhere else. For "sign
// out my other sessions" or "remove this member's login", a minute is not a meaningful window --
// the alternative is a 30-day one.
//
// ── WHY THE ROLE IS RESOLVED HERE AND NOT CARRIED IN THE TOKEN ────────────────────────────────
// Widening this lookup rather than adding an accountRole claim costs nothing (same query count,
// same round trips as the token-version check it replaces) and buys three things a claim cannot:
// removing a membership takes effect in <=60s instead of 30 days; a role change likewise; and
// there is no "what does an absent claim mean" question, whose only natural-looking answer
// (OWNER) fails open. See AccountAccess's header.
@Service
public class AccountAccessService {

    private record AccessKey(Long userId, Long accountId) {
    }

    private final AccountMembershipRepository membershipRepository;
    private final SubscriptionService subscriptionService;

    // A negative result (no membership) is cached as an empty Optional rather than not cached at
    // all: a revoked login whose device keeps retrying must not turn into a database read per
    // request. Caffeine cannot store null, hence Optional as the value type.
    private final Cache<AccessKey, Optional<CachedAccess>> rows = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(60))
            .maximumSize(10_000)
            .build();

    /**
     * The membership row plus the household's plan.
     *
     * <p>⚠️ <b>{@code accountIsPro} is cached HERE rather than resolved per request, and that is
     * the whole reason this record exists.</b> {@code SubscriptionService.isPlus} is a database read,
     * and phase 8 needs the answer on EVERY request — {@code PermissionInterceptor} asks whether a
     * member is paused before it asks anything else. Calling it from {@code resolve()} would add a
     * query per request to the app's hottest path and undo exactly what this cache is for.
     *
     * <p>Cached, it costs one extra read per cache MISS (so at most one a minute per login), and
     * nothing on a hit. The staleness that buys is bounded by the same 60s TTL as the membership
     * itself, and {@code invalidateAccount} makes a real plan change take effect immediately —
     * see {@code AccountPlanChangedListener} for what calls it.
     */
    private record CachedAccess(AccountAccessRow row, boolean accountIsPro) {
    }

    public AccountAccessService(AccountMembershipRepository membershipRepository,
                                 SubscriptionService subscriptionService) {
        this.membershipRepository = membershipRepository;
        this.subscriptionService = subscriptionService;
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
        Optional<CachedAccess> cached = rows.get(new AccessKey(userId, accountId),
                key -> membershipRepository.findAccessRow(key.userId(), key.accountId())
                        // Resolved on the miss, inside the loader, so a hit stays a pure memory
                        // read. See CachedAccess.
                        .map(r -> new CachedAccess(r, subscriptionService.isPlus(r.accountId()))));

        return cached.filter(c -> c.row().tokenVersion() == tokenVersion)
                .map(c -> new AccountAccess(c.row().userId(), c.row().accountId(),
                        c.row().membershipId(), c.row().accountRole(), c.row().personId(),
                        c.row().membersSeeEveryone(), c.accountIsPro()));
    }

    /** After a membership is created, removed, or has its role or person changed. */
    public void invalidate(Long userId, Long accountId) {
        rows.invalidate(new AccessKey(userId, accountId));
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
        rows.asMap().keySet().removeIf(key -> key.userId().equals(userId));
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
        rows.asMap().keySet().removeIf(key -> key.accountId().equals(accountId));
    }
}
