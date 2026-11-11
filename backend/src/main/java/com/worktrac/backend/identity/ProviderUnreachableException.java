package com.worktrac.backend.identity;

/**
 * We could not fetch the provider's signing keys, so we cannot tell whether the token is good.
 *
 * <p>Kept apart from {@link InvalidIdTokenException} on purpose: "Google is having a moment" must
 * read as "try again" (503), never as "that sign-in was bad". Collapsing the two would tell somebody
 * whose sign-in was perfectly fine that it was refused.
 */
public class ProviderUnreachableException extends RuntimeException {

    public ProviderUnreachableException(String message, Throwable cause) {
        super(message, cause);
    }
}
