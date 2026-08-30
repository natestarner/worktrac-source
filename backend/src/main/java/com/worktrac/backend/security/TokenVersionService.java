package com.worktrac.backend.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.worktrac.backend.user.UserRepository;
import org.springframework.stereotype.Service;

import java.time.Duration;

// "Is this token still valid?" -- the current token_version for a user, cached.
//
// ⚠️ THE CACHE IS THE WHOLE POINT, not an optimisation bolted on afterwards. This is consulted on
// EVERY authenticated request, so the obvious implementation -- read users by id each time -- would
// add a database round trip to the hottest path in the app, and would acquire its own connection
// outside the request's transaction. With a Hikari pool of 10, that is a meaningful step toward the
// pool-exhaustion behaviour docs/architecture/resilience.md describes, where requests queue past
// the client's 15s abort and the app reports itself as lie-fi. Paying that on every set logged, to
// catch something that happens perhaps once in an account's lifetime, is the wrong trade.
//
// The 60-second TTL is what that buys, and the cost is bounded and stated: a bump takes effect
// immediately on the replica that made it (invalidate below is called directly), and within a
// minute everywhere else. For "sign out my other sessions", a minute is not a meaningful window --
// the alternative is a 30-day one.
@Service
public class TokenVersionService {

    private final UserRepository userRepository;

    private final Cache<Long, Integer> versions = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(60))
            .maximumSize(10_000)
            .build();

    public TokenVersionService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    // A token whose version no longer matches the user's has been revoked. A user that no longer
    // exists fails closed: their token stops working immediately rather than outliving the account.
    public boolean isCurrent(Long userId, int tokenVersion) {
        Integer current = versions.get(userId,
                id -> userRepository.findById(id).map(user -> user.getTokenVersion()).orElse(null));
        return current != null && current == tokenVersion;
    }

    // Called right after a bump commits, so the replica that performed it stops honouring old
    // tokens at once instead of waiting out the TTL.
    public void invalidate(Long userId) {
        versions.invalidate(userId);
    }
}
