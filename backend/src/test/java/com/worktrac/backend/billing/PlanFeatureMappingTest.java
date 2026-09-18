package com.worktrac.backend.billing;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.EnumSet;

import static org.assertj.core.api.Assertions.assertThat;

// Pins BillingPlan.features(), which is the only place in the codebase that turns a TIER into
// capability. Everything else asks SubscriptionService.has(accountId, PlanFeature), so if this
// table is right and nothing else branches on a tier, the whole entitlement model is right.
//
// The tier-level twin of PermissionMappingTest, and deliberately exhaustive for the same reason:
// this is the file someone will edit when they add a tier or a feature, and a table test that only
// asserts the interesting rows silently grants whatever it forgot to mention.
class PlanFeatureMappingTest {

    @Nested
    @DisplayName("FREE")
    class Free {

        // ⚠️ Empty, not "a subset of PLUS". Everything Free actually gets -- unlimited workouts,
        // every person in the household, offline logging, PRs, routines, and the full data export
        // -- is ungated, so none of it is a PlanFeature at all. Several of those are promised in
        // writing on the marketing site for BOTH plans; listing them here would invite gating one.
        @Test
        void holdsNoFeature() {
            assertThat(BillingPlan.FREE.features()).isEmpty();
        }

        @Test
        void isNotPaid() {
            assertThat(BillingPlan.FREE.isPaid()).isFalse();
        }

        @Test
        void answersFalseForEveryFeature() {
            for (PlanFeature feature : PlanFeature.values()) {
                assertThat(BillingPlan.FREE.has(feature)).as("FREE.has(%s)", feature).isFalse();
            }
        }
    }

    @Nested
    @DisplayName("PLUS")
    class Plus {

        // The three things Plus actually sells, and the list the marketing pricing card, the
        // billing screen's PLUS_BENEFITS and the handbook's plan table all describe in prose.
        // If this set changes, all three of those change in the same commit.
        @Test
        void holdsExactlyTheThreePaidFeatures() {
            assertThat(BillingPlan.PLUS.features()).containsExactlyInAnyOrder(
                    PlanFeature.FULL_HISTORY,
                    PlanFeature.DATA_IMPORT,
                    PlanFeature.MEMBER_LOGINS);
        }

        @Test
        void isPaid() {
            assertThat(BillingPlan.PLUS.isPaid()).isTrue();
        }

        // A family tier must NOT be able to make its members private. Free and Plus are forced to
        // "everyone sees everyone" by not holding this, which is what replaced Account's missing
        // setter as the enforcement -- see V66 and Account.setMembersSeeEveryone.
        @Test
        void cannotMakeItsMembersPrivate() {
            assertThat(BillingPlan.PLUS.has(PlanFeature.PRIVATE_MEMBERS)).isFalse();
            assertThat(BillingPlan.FREE.has(PlanFeature.PRIVATE_MEMBERS)).isFalse();
        }
    }

    @Nested
    @DisplayName("PRO")
    class Pro {

        // ⚠️ Built FROM Plus's set rather than retyped, so a feature added to Plus cannot be
        // silently missing from the tier above it -- which would present as a household paying
        // more and getting less. This is the assertion that keeps that true.
        @Test
        void holdsEverythingPlusHolds() {
            assertThat(BillingPlan.PRO.features())
                    .containsAll(BillingPlan.PLUS.features());
        }

        // The two that make it a trainer product rather than a bigger Plus: clients who cannot see
        // each other, and an assistant who can see all of them.
        @Test
        void addsPrivateMembersAndTheManagerRole() {
            assertThat(BillingPlan.PRO.features())
                    .contains(PlanFeature.PRIVATE_MEMBERS, PlanFeature.MANAGER_ROLE);
        }

        // Discovery, not access -- CheckInController itself gates on nothing but the person guard.
        // This is what makes the account-menu link Pro-only without touching what the route allows.
        @Test
        void grantsTheRosterAndCheckInsEntryPoints() {
            assertThat(BillingPlan.PRO.features()).contains(PlanFeature.ROSTER, PlanFeature.CHECK_INS);
        }

        @Test
        void isPaid() {
            assertThat(BillingPlan.PRO.isPaid()).isTrue();
        }
    }

    @Nested
    @DisplayName("the map as a whole")
    class TheMap {

        // ⚠️ Every feature must be granted by SOMETHING. A PlanFeature no tier holds is a gate
        // nobody can ever pass -- it would silently turn its feature off for the entire product,
        // and the only symptom would be a capability quietly missing everywhere.
        @Test
        void everyFeatureIsGrantedByAtLeastOneTier() {
            EnumSet<PlanFeature> granted = EnumSet.noneOf(PlanFeature.class);
            for (BillingPlan plan : BillingPlan.values()) {
                granted.addAll(plan.features());
            }
            assertThat(granted).containsExactlyInAnyOrderElementsOf(EnumSet.allOf(PlanFeature.class));
        }

        // The returned sets are shared constants, so a caller that mutated one would change what
        // every other household is entitled to for the life of the JVM.
        @Test
        void featureSetsAreUnmodifiable() {
            for (BillingPlan plan : BillingPlan.values()) {
                assertThat(plan.features()).isUnmodifiable();
            }
        }
    }
}
