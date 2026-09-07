package com.worktrac.backend.security;

import com.worktrac.backend.membership.AccountAccess;

// Custom authentication principal populated by JwtAuthenticationFilter from a validated
// token's claims. CurrentUser reads accountId/userId only from here (via
// SecurityContextHolder) -- these values must never be trusted from a request
// body/path, since that would let one account act as another.
//
// `access` is deliberately NOT parsed from the token. JwtService builds this record with a null
// access from the claims alone, and JwtAuthenticationFilter then attaches the resolved
// AccountAccess before the principal reaches the SecurityContext -- so it is resolved exactly
// once per request, and what a login MAY DO is answered server-side rather than frozen into a
// 30-day token. AccountAccess's own header explains why that distinction is load-bearing.
public record AccountPrincipal(Long userId, Long accountId, String email, String role,
                                int tokenVersion, AccountAccess access) {

    // Claims-only form, used by JwtService before the filter has resolved membership. A principal
    // in this state must never reach the SecurityContext -- CurrentUser.access() throws if it does.
    public AccountPrincipal(Long userId, Long accountId, String email, String role, int tokenVersion) {
        this(userId, accountId, email, role, tokenVersion, null);
    }

    public AccountPrincipal withAccess(AccountAccess resolved) {
        return new AccountPrincipal(userId, accountId, email, role, tokenVersion, resolved);
    }
}
