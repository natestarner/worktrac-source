package com.worktrac.backend.identity;

/**
 * The ID token did not prove anything: bad signature, wrong audience or issuer, expired, too old,
 * wrong nonce, malformed. The message is for OUR logs (which check failed), never for the caller --
 * telling a forger which check to work on next helps nobody but them.
 */
public class InvalidIdTokenException extends RuntimeException {

    public InvalidIdTokenException(String reason) {
        super(reason);
    }

    public InvalidIdTokenException(String reason, Throwable cause) {
        super(reason, cause);
    }
}
