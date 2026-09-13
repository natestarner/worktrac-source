package com.worktrac.backend.security;

/**
 * Who a half-finished sign-in belongs to: the password has been proved, the household has not been
 * chosen yet.
 *
 * <p>Deliberately NOT an {@link AccountPrincipal}. That type is what the security filter puts into
 * the context, and every service in the app takes an account boundary for granted once one exists.
 * A separate type means a selection token cannot be mistaken for a session by any code that has not
 * explicitly asked for one — the compiler enforces what a comment could only request.
 *
 * <p>Carries {@code tokenVersion} so the mint route can apply the same revocation check every other
 * authenticated path does: a password reset landing between picking a household and finishing the
 * pick has to invalidate this too.
 */
public record SelectionPrincipal(Long userId, String email, int tokenVersion) {
}
