package com.worktrac.backend.security;

import com.worktrac.backend.membership.AccountAccess;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.Optional;

// The one place account/user identity is read out of the security context. Every
// controller/service that needs "who is calling" goes through here instead of trusting
// a client-supplied accountId/personId -- that is the account-scoping boundary for the
// whole app.
//
// access() is the newer, wider answer and the one new code should reach for: it carries the
// account id AND what this login may do with it. accountId()/userId() remain for the many call
// sites that only need an id, and are just projections of the same record.
@Component
public class CurrentUser {

    public AccountPrincipal get() {
        return optional()
                .orElseThrow(() -> new IllegalStateException("No authenticated AccountPrincipal in security context"));
    }

    /**
     * Who is calling, when there may legitimately be nobody.
     *
     * <p>For {@code permitAll} routes that behave differently for a caller who happens to already
     * be signed in — {@code POST /api/auth/accept-invite} is the one today, where an existing
     * session belonging to the invited address is proof enough to join without retyping a
     * password. {@link #get()} throws for those, and correctly: everywhere else, no principal is a
     * wiring bug rather than a state to branch on.
     *
     * <p>⚠️ <b>A principal here has been fully validated, and that is the whole reason this is the
     * right way to ask.</b> {@code JwtAuthenticationFilter} runs on every request, permitAll
     * included, and only reaches the SecurityContext after checking the signature, refusing
     * anything carrying {@code scp}, AND resolving the token's {@code tv} against the live user
     * row and membership. Hand-parsing the Authorization header instead — as
     * {@code POST /api/auth/session} must, because a selection token deliberately cannot
     * authenticate through the filter — skips that second half: {@link JwtService#parseToken}
     * alone does <b>not</b> compare {@code tv} to the database, so a token invalidated by a
     * password reset still parses. Reach for the header directly only when a selection token is
     * genuinely the point, and never as a shortcut to identity.
     */
    public Optional<AccountPrincipal> optional() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AccountPrincipal accountPrincipal)) {
            return Optional.empty();
        }
        return Optional.of(accountPrincipal);
    }

    /**
     * What this login may do in the account it is acting on, resolved once per request by
     * JwtAuthenticationFilter.
     *
     * <p>Throws rather than defaulting if the principal reached the context without one. A missing
     * AccountAccess is a wiring bug, and the only safe-looking default (full owner rights) is
     * precisely the one that fails open -- so this fails loudly at the boundary instead of quietly
     * granting everything deep inside a service.
     */
    public AccountAccess access() {
        AccountAccess access = get().access();
        if (access == null) {
            throw new IllegalStateException("AccountPrincipal reached the security context without an AccountAccess");
        }
        return access;
    }

    public Long accountId() {
        return get().accountId();
    }

    public Long userId() {
        return get().userId();
    }
}
