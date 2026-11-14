package com.worktrac.backend.billing.store;

/**
 * The store could not be reached or answered with an error: TRANSIENT. Callers answer 503 (the app
 * keeps the transaction unfinished and sends it again; the store redelivers its message), never a
 * 4xx, which would tell both to give up.
 */
public class StoreBillingException extends Exception {

    public StoreBillingException(String message, Throwable cause) {
        super(message, cause);
    }

    public StoreBillingException(String message) {
        super(message);
    }
}
