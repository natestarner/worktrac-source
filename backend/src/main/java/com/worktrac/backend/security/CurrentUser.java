package com.worktrac.backend.security;

import com.worktrac.backend.membership.AccountAccess;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

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
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (!(principal instanceof AccountPrincipal accountPrincipal)) {
            throw new IllegalStateException("No authenticated AccountPrincipal in security context");
        }
        return accountPrincipal;
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
