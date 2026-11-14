package com.worktrac.backend.billing;

import java.util.Arrays;
import java.util.Optional;

/**
 * Who bills a household: Stripe on the web, or the app store of the app it bought in. Exactly one at
 * a time -- see docs/in-app-purchase-plan.md and .claude/rules/billing.md ("Who bills a household").
 *
 * <p>Stored as the enum NAME in {@code subscriptions.billing_source} (V105), so renaming a constant
 * is a data migration.
 */
public enum BillingSource {

    STRIPE("stripe", true),
    APP_STORE("app-store", false),
    GOOGLE_PLAY("google-play", true);

    private final String pathSegment;
    private final boolean weCanCancel;

    BillingSource(String pathSegment, boolean weCanCancel) {
        this.pathSegment = pathSegment;
        this.weCanCancel = weCanCancel;
    }

    /** How a store is named in a URL: {@code /api/billing/store/app-store/prepare}. */
    public String pathSegment() {
        return pathSegment;
    }

    /**
     * Whether WE can cancel (and refund) a subscription from this source. Stripe and Google Play let
     * the merchant cancel server-side; Apple does not -- only the subscriber can, in Settings.
     *
     * <p>THE overlap rule hangs on this one fact: when two sources are paying for one household, the
     * one we cannot cancel stays and the one we can is cancelled and refunded. Kept on the enum, not
     * on each provider, so the rule reads the same for every pair of sources, Stripe included.
     */
    public boolean weCanCancel() {
        return weCanCancel;
    }

    public boolean isStore() {
        return this != STRIPE;
    }

    /** The store a URL names; never STRIPE, which has its own endpoints. */
    public static Optional<BillingSource> storeFromPathSegment(String segment) {
        return Arrays.stream(values())
                .filter(source -> source.isStore() && source.pathSegment.equals(segment))
                .findFirst();
    }
}
