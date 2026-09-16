package com.worktrac.backend.billing;

import java.util.Arrays;
import java.util.Optional;

// Everything Huddle actually sells, one constant per thing. A SKU is a (plan, band, interval)
// triple, and each one maps to exactly one Stripe Price in each Stripe mode.
//
// ⚠️ THE ENUM NAME IS THE CONFIG KEY. `app.stripe.prices.PRO_STUDIO_YEAR` is looked up by
// PRO_STUDIO_YEAR.name(), so renaming a constant is a config change in three places (repo secrets,
// the deploy workflow's env block, and config/{lower,production}/backend-env.json). That coupling
// is deliberate: the alternative is a hand-written key string beside each constant, which is one
// more thing that can disagree with itself.
//
// ⚠️ THE REVERSE DIRECTION IS WHY THIS IS AN ENUM AND NOT A FORMATTING FUNCTION. A Stripe webhook
// carries a price id and nothing else that names a tier, and `.claude/rules/billing.md` requires
// re-fetching the subscription and writing THAT rather than trusting a payload. So the only way to
// know which tier a paying household is on is to map the price id back -- see
// StripeProperties.skuForPriceId. A closed set is what makes that lookup total.
//
// Why the client never sends a price id (billing.md): it sends plan + band + interval, symbols the
// server maps here. Accepting an id from a browser lets a caller check out against a price they
// invented; accepting symbols lets them check out against one we actually sell.
public enum PlanSku {

    // Plus has no bands -- it is a household tier, priced per household.
    PLUS_MONTH(BillingPlan.PLUS, null, BillingInterval.MONTH),
    PLUS_YEAR(BillingPlan.PLUS, null, BillingInterval.YEAR),

    PRO_STARTER_MONTH(BillingPlan.PRO, ClientBand.STARTER, BillingInterval.MONTH),
    PRO_STARTER_YEAR(BillingPlan.PRO, ClientBand.STARTER, BillingInterval.YEAR),
    PRO_STUDIO_MONTH(BillingPlan.PRO, ClientBand.STUDIO, BillingInterval.MONTH),
    PRO_STUDIO_YEAR(BillingPlan.PRO, ClientBand.STUDIO, BillingInterval.YEAR),
    PRO_PRACTICE_MONTH(BillingPlan.PRO, ClientBand.PRACTICE, BillingInterval.MONTH),
    PRO_PRACTICE_YEAR(BillingPlan.PRO, ClientBand.PRACTICE, BillingInterval.YEAR),
    PRO_UNLIMITED_MONTH(BillingPlan.PRO, ClientBand.UNLIMITED, BillingInterval.MONTH),
    PRO_UNLIMITED_YEAR(BillingPlan.PRO, ClientBand.UNLIMITED, BillingInterval.YEAR);

    private final BillingPlan plan;
    private final ClientBand band;
    private final BillingInterval interval;

    PlanSku(BillingPlan plan, ClientBand band, BillingInterval interval) {
        this.plan = plan;
        this.band = band;
        this.interval = interval;
    }

    public BillingPlan plan() {
        return plan;
    }

    /** Null for a tier that is not priced by size. */
    public ClientBand band() {
        return band;
    }

    public BillingInterval interval() {
        return interval;
    }

    /**
     * The SKU for a plan, band and interval, or empty when that combination is not something we
     * sell.
     *
     * <p>Empty is the answer for a caller asking for FREE (nothing to buy), for PLUS with a band
     * (it has none), and for PRO without one (it requires one). Returning empty rather than
     * throwing keeps the validation at the controller, where it can become a 400 with a message,
     * instead of a 500 from deep inside billing.
     */
    public static Optional<PlanSku> of(BillingPlan plan, ClientBand band, BillingInterval interval) {
        return Arrays.stream(values())
                .filter(sku -> sku.plan == plan && sku.band == band && sku.interval == interval)
                .findFirst();
    }
}
