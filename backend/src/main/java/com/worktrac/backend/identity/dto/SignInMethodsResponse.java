package com.worktrac.backend.identity.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /api/user/sign-in-methods}: the caller's OWN ways in. Never the provider's subject id
 * -- it is the key to the identity and nothing on screen needs it.
 *
 * @param hasPassword whether this login has a password at all (false for an Apple/Google sign-up
 *                    that never set one)
 * @param connected   the providers linked to this login
 * @param available   providers this environment can connect right now, by path name
 */
public record SignInMethodsResponse(boolean hasPassword, List<Connected> connected, List<String> available) {

    public record Connected(String provider, Instant connectedAt, Instant lastUsedAt) {
    }
}
