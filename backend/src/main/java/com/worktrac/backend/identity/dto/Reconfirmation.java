package com.worktrac.backend.identity.dto;

import jakarta.validation.constraints.Size;

/**
 * Proof, by signing in with Apple or Google again, that the person at the keyboard owns this login.
 * Carried by the requests that need more than a session: deleting the account, and setting a first
 * password. A session proves a DEVICE, not a person (a family tablet left signed in), which is why
 * those actions have always asked for the password -- and this is the password's equivalent for a
 * login that has none.
 *
 * @param provider               "apple" or "google" (or "test" in local/lower)
 * @param idToken                a fresh ID token from that provider
 * @param nonce                  the raw nonce, as for a sign-in
 * @param appleAuthorizationCode Apple only, and needed only for deletion: the one-time code from
 *                               the same sheet, used to revoke Huddle's Apple sign-in
 * @param appleRedirectUri       Apple on the WEB only: the redirect URI the code was issued with
 */
public record Reconfirmation(
        @Size(max = 20) String provider,
        @Size(max = 8192) String idToken,
        @Size(max = 256) String nonce,
        @Size(max = 2048) String appleAuthorizationCode,
        @Size(max = 2048) String appleRedirectUri) {

    public boolean isPresent() {
        return idToken != null && !idToken.isBlank();
    }
}
