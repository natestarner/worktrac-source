package com.worktrac.backend.billing.store;

/**
 * What we were sent is not a genuine store purchase or message (bad signature, another app, an
 * environment we never accept, malformed): PERMANENT. It will never verify, so it is rejected and the
 * app may finish the transaction rather than retry it forever.
 */
public class StoreVerificationException extends Exception {

    public StoreVerificationException(String message, Throwable cause) {
        super(message, cause);
    }

    public StoreVerificationException(String message) {
        super(message);
    }
}
