package com.worktrac.backend.identity.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /api/auth/oauth/{provider}}.
 *
 * @param idToken     the provider's ID token, as the client received it
 * @param nonce       the RAW nonce; the client gave the provider only its SHA-256 hex
 * @param personName  only for signing UP: absent on the first try, which answers 409
 *                    {@code SIGN_UP_REQUIRED} when there is no login yet. Same cap as
 *                    {@code RegisterRequest}, for the same reason (people.name is 100)
 * @param accountName optional, as at registration; blank defaults to "{name}'s Household"
 */
public record SocialSignInRequest(
        @NotBlank @Size(max = 8192, message = "must be 8192 characters or fewer") String idToken,
        @NotBlank @Size(min = 16, max = 256, message = "must be between 16 and 256 characters") String nonce,
        @Size(max = 100, message = "must be 100 characters or fewer") String personName,
        @Size(max = 200, message = "must be 200 characters or fewer") String accountName) {
}
