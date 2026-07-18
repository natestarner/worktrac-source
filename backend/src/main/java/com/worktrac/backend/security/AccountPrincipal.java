package com.worktrac.backend.security;

// Custom authentication principal populated by JwtAuthenticationFilter from a validated
// token's claims. CurrentUser reads accountId/userId only from here (via
// SecurityContextHolder) -- these values must never be trusted from a request
// body/path, since that would let one account act as another.
public record AccountPrincipal(Long userId, Long accountId, String email, String role) {
}
