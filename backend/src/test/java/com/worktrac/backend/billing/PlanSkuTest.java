package com.worktrac.backend.billing;

import com.worktrac.backend.config.StripeProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// The catalogue of what Huddle sells, and the two directions a price has to travel: symbols in
// (checkout), price id back out (webhooks). Both matter, and the reverse direction is the one with
// no other way to answer "which tier is this household paying for".
class PlanSkuTest {

    @Nested
    @DisplayName("what we sell")
    class Catalogue {

        @Test
        void plusHasNoBandAndProAlwaysDoes() {
            for (PlanSku sku : PlanSku.values()) {
                if (sku.plan() == BillingPlan.PLUS) {
                    assertThat(sku.band()).as("%s should have no band", sku).isNull();
                } else {
                    assertThat(sku.band()).as("%s should name a band", sku).isNotNull();
                }
            }
        }

        // Every sellable tier must be buyable at both intervals, or the plan chooser offers a
        // toggle that half works.
        @Test
        void everySellableCombinationExistsAtBothIntervals() {
            for (PlanSku sku : PlanSku.values()) {
                assertThat(PlanSku.of(sku.plan(), sku.band(), BillingInterval.MONTH))
                        .as("%s monthly", sku).isPresent();
                assertThat(PlanSku.of(sku.plan(), sku.band(), BillingInterval.YEAR))
                        .as("%s yearly", sku).isPresent();
            }
        }

        // ⚠️ The combinations that must NOT resolve. This is what turns "PLUS with a band" and "PRO
        // without one" into a 400 at the controller instead of a checkout against the wrong price.
        @Test
        void combinationsWeDoNotSellResolveToNothing() {
            assertThat(PlanSku.of(BillingPlan.FREE, null, BillingInterval.MONTH)).isEmpty();
            assertThat(PlanSku.of(BillingPlan.PLUS, ClientBand.STUDIO, BillingInterval.YEAR)).isEmpty();
            assertThat(PlanSku.of(BillingPlan.PRO, null, BillingInterval.YEAR)).isEmpty();
        }
    }

    @Nested
    @DisplayName("price ids, both directions")
    class Prices {

        private StripeProperties propertiesWith(Map<String, String> prices) {
            StripeProperties properties = new StripeProperties();
            properties.setPrices(new LinkedHashMap<>(prices));
            return properties;
        }

        @Test
        void aConfiguredSkuResolvesForwardAndBack() {
            StripeProperties properties = propertiesWith(Map.of(
                    PlanSku.PRO_PRACTICE_MONTH.name(), "price_abc"));

            assertThat(properties.priceIdFor(PlanSku.PRO_PRACTICE_MONTH)).contains("price_abc");
            assertThat(properties.skuForPriceId("price_abc")).contains(PlanSku.PRO_PRACTICE_MONTH);
        }

        // ⚠️ A MISSING ENTRY IS LEGAL AND MUST NOT THROW. An environment that has Plus prices and
        // no Pro ones is every environment for the length of a tier rollout; the whole reason
        // isConfigured() stopped asking about prices is so one missing Pro key cannot switch off
        // Plus checkout.
        @Test
        void anUnconfiguredSkuIsEmptyRatherThanAnError() {
            StripeProperties properties = propertiesWith(Map.of(PlanSku.PLUS_MONTH.name(), "price_plus"));

            assertThat(properties.priceIdFor(PlanSku.PRO_STARTER_YEAR)).isEmpty();
            assertThat(properties.sells(BillingPlan.PLUS)).isTrue();
            assertThat(properties.sells(BillingPlan.PRO)).isFalse();
        }

        // A blank env var is how an unset one actually arrives -- `${STRIPE_PRICE_PRO_X:}` binds to
        // "" rather than to absent -- so treating blank as configured would make every environment
        // claim it sells every tier.
        @Test
        void aBlankEntryCountsAsUnconfigured() {
            StripeProperties properties = propertiesWith(Map.of(
                    PlanSku.PLUS_MONTH.name(), "  ",
                    PlanSku.PLUS_YEAR.name(), ""));

            assertThat(properties.priceIdFor(PlanSku.PLUS_MONTH)).isEmpty();
            assertThat(properties.sellsAnything()).isFalse();
        }

        // The reverse lookup is the one a webhook depends on, and an unknown id there is a config
        // gap rather than a fact about the household -- so it answers empty and lets the caller
        // decide, rather than guessing a tier.
        @Test
        void anUnknownPriceIdMapsToNothing() {
            StripeProperties properties = propertiesWith(Map.of(PlanSku.PLUS_MONTH.name(), "price_plus"));

            assertThat(properties.skuForPriceId("price_someone_elses")).isEmpty();
            assertThat(properties.skuForPriceId(null)).isEmpty();
            assertThat(properties.skuForPriceId("")).isEmpty();
        }
    }

    @Nested
    @DisplayName("bands")
    class Bands {

        @Test
        void aBandAllowsUpToItsLimitAndNoFurther() {
            assertThat(ClientBand.STARTER.clientLimit()).isEqualTo(5);
            assertThat(ClientBand.STARTER.allows(4)).isTrue();
            assertThat(ClientBand.STARTER.allows(5)).isFalse();
        }

        // Null rather than a sentinel: "unlimited" and "a very large number" read the same in a
        // comparison and completely differently in copy, and the billing screen has to say one.
        @Test
        void unlimitedHasNoLimitAndAlwaysAllows() {
            assertThat(ClientBand.UNLIMITED.clientLimit()).isNull();
            assertThat(ClientBand.UNLIMITED.allows(10_000)).isTrue();
        }

        // Bands are a ladder, and the pricing page presents them in this order. A band that did not
        // increase would make "move up a plan to add more" false.
        @Test
        void theBandsStrictlyIncrease() {
            assertThat(ClientBand.STARTER.clientLimit()).isLessThan(ClientBand.STUDIO.clientLimit());
            assertThat(ClientBand.STUDIO.clientLimit()).isLessThan(ClientBand.PRACTICE.clientLimit());
        }
    }
}
