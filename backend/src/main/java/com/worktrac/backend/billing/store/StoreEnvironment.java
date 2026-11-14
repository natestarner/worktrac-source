package com.worktrac.backend.billing.store;

/**
 * Which of a store's two worlds a purchase came from. App Review and TestFlight buy in SANDBOX even
 * against the production backend, so both are accepted everywhere (docs/in-app-purchase-plan.md);
 * a sandbox subscription renews every few minutes for about an hour and then expires by itself.
 */
public enum StoreEnvironment {
    PRODUCTION,
    SANDBOX
}
