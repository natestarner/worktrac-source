package com.worktrac.backend.security;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

// The one place account/user identity is read out of the security context. Every
// controller/service that needs "who is calling" goes through here instead of trusting
// a client-supplied accountId/personId -- that is the account-scoping boundary for the
// whole app.
@Component
public class CurrentUser {

    public AccountPrincipal get() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (!(principal instanceof AccountPrincipal accountPrincipal)) {
            throw new IllegalStateException("No authenticated AccountPrincipal in security context");
        }
        return accountPrincipal;
    }

    public Long accountId() {
        return get().accountId();
    }

    public Long userId() {
        return get().userId();
    }
}
