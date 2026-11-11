package com.worktrac.backend.identity;

import java.util.Arrays;
import java.util.Optional;

/**
 * Who can vouch for a Huddle login besides its password. Stored by name in
 * {@code user_identities.provider}, whose CHECK constraint (V103) must list every constant.
 *
 * <p>{@link #TEST} is the e2e suite's stand-in for Apple and Google, which bot checks keep out of
 * automation. It exists only where {@link TestIdentityTokens} does (local and lower) -- see
 * {@link IdTokenVerifier#isAvailable}.
 */
public enum IdentityProvider {
    APPLE("apple", "Apple"),
    GOOGLE("google", "Google"),
    TEST("test", "Test");

    private final String path;
    private final String displayName;

    IdentityProvider(String path, String displayName) {
        this.path = path;
        this.displayName = displayName;
    }

    /** The lower-case name used in URLs ({@code /api/auth/oauth/google}) and responses. */
    public String path() {
        return path;
    }

    /** For messages a person reads: "connect Google in Profile". */
    public String displayName() {
        return displayName;
    }

    public static Optional<IdentityProvider> fromPath(String path) {
        return Arrays.stream(values()).filter(p -> p.path.equals(path)).findFirst();
    }
}
