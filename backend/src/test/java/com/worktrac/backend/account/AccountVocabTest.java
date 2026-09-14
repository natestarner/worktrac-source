package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingPlan;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

// Pins AccountVocab.forPlan(), the only place a tier becomes a NOUN.
//
// The third member of the family that includes PermissionMappingTest (role -> authority) and
// PlanFeatureMappingTest (tier -> capability). Unlike those two, nothing here decides what anybody
// may DO -- which is exactly the property worth keeping true, so the last test in this file asserts
// that this map cannot be mistaken for one of those.
class AccountVocabTest {

    @Nested
    @DisplayName("every tier")
    class EveryTier {

        // ⚠️ The one that matters when Team lands. The switch in forPlan has no default, so a new
        // BillingPlan constant fails to COMPILE until somebody maps it -- but a lazy fix
        // ("case TEAM -> FAMILY") would compile fine and silently call a sports team a household.
        // This is what makes that show up as a red test rather than a screenshot in a bug report.
        @ParameterizedTest
        @EnumSource(BillingPlan.class)
        void hasACompleteSetOfNouns(BillingPlan plan) {
            AccountVocab vocab = AccountVocab.forPlan(plan);

            assertThat(vocab).as("no tier may be unmapped").isNotNull();
            assertThat(List.of(vocab.account(), vocab.owner(), vocab.member(), vocab.manager()))
                    .as("%s must name all four", plan)
                    .allSatisfy(noun -> assertThat(noun).isNotBlank());
        }

        // A sentence can legitimately use two of these together ("the household owner can add a
        // family member"), so two nouns collapsing to the same word makes that sentence nonsense
        // rather than merely repetitive.
        @ParameterizedTest
        @EnumSource(BillingPlan.class)
        void namesFourDISTINCTthings(BillingPlan plan) {
            AccountVocab vocab = AccountVocab.forPlan(plan);

            Set<String> distinct = Set.copyOf(
                    List.of(vocab.account(), vocab.owner(), vocab.member(), vocab.manager()));
            assertThat(distinct).as("%s reuses a noun for two different things", plan).hasSize(4);
        }

        // These are rendered mid-sentence ("... owns this household.") and capitalised by the
        // client for labels. A noun that arrived already capitalised would read as a proper name in
        // the sentence, and one with padding would render a visible gap.
        @ParameterizedTest
        @EnumSource(BillingPlan.class)
        void isLowercaseAndTrimmed(BillingPlan plan) {
            AccountVocab vocab = AccountVocab.forPlan(plan);

            assertThat(List.of(vocab.account(), vocab.owner(), vocab.member(), vocab.manager()))
                    .allSatisfy(noun -> {
                        assertThat(noun).isEqualTo(noun.toLowerCase());
                        assertThat(noun).isEqualTo(noun.trim());
                    });
        }
    }

    @Nested
    @DisplayName("the family tiers")
    class FamilyTiers {

        // Free and Plus are the same product to a family; only history length and logins differ.
        // If these ever diverge it is a pricing decision that reached the wrong file.
        @Test
        void speakIdentically() {
            assertThat(AccountVocab.forPlan(BillingPlan.FREE))
                    .isEqualTo(AccountVocab.forPlan(BillingPlan.PLUS));
        }

        @Test
        void useTheAppsOriginalVocabulary() {
            assertThat(AccountVocab.forPlan(BillingPlan.PLUS))
                    .isEqualTo(new AccountVocab("household", "household owner", "family member", "co-parent"));
        }
    }

    @Nested
    @DisplayName("PRO")
    class Pro {

        // The whole reason this class exists. A client paying a trainer should not be told they are
        // in that person's "household".
        @Test
        void speaksLikeAPractice() {
            assertThat(AccountVocab.forPlan(BillingPlan.PRO))
                    .isEqualTo(new AccountVocab("practice", "trainer", "client", "assistant"));
        }

        @Test
        void sharesNoNounWithTheFamilyTiers() {
            AccountVocab family = AccountVocab.forPlan(BillingPlan.FREE);
            AccountVocab pro = AccountVocab.forPlan(BillingPlan.PRO);

            assertThat(pro.account()).isNotEqualTo(family.account());
            assertThat(pro.owner()).isNotEqualTo(family.owner());
            assertThat(pro.member()).isNotEqualTo(family.member());
            assertThat(pro.manager()).isNotEqualTo(family.manager());
        }

        // ⚠️ "coach" is reserved for TEAM's OWNER, and this is the assertion that records why the
        // assistant role is called MANAGER rather than COACH. Pro's assistant must not squat on the
        // word before Team gets to use it.
        @Test
        void doesNotUseTheWordTeamWillNeed() {
            AccountVocab pro = AccountVocab.forPlan(BillingPlan.PRO);

            assertThat(List.of(pro.account(), pro.owner(), pro.member(), pro.manager()))
                    .doesNotContain("coach", "assistant coach", "athlete", "team");
        }
    }

    @Nested
    @DisplayName("as a whole")
    class AsAWhole {

        // ⚠️ THIS IS PRESENTATION, NOT AUTHORITY, and that boundary is easy to erode: the next
        // person who needs a per-tier answer will find this map and be tempted to add a boolean to
        // it. Tiers become capability in BillingPlan.features() and roles become authority in
        // AccountRole.permissions() -- both of which this record must stay incapable of expressing.
        @Test
        void carriesNothingButWords() {
            assertThat(AccountVocab.class.getRecordComponents())
                    .allSatisfy(component -> assertThat(component.getType()).isEqualTo(String.class));
        }

        // Two tiers may legitimately share a vocabulary (Free and Plus do), but every tier must
        // resolve to one of a small, deliberate set -- not to a per-tier copy that drifts.
        @Test
        void hasFewerVocabulariesThanTiers() {
            Set<AccountVocab> distinct = java.util.Arrays.stream(BillingPlan.values())
                    .map(AccountVocab::forPlan)
                    .collect(Collectors.toSet());

            assertThat(distinct).hasSizeLessThan(BillingPlan.values().length);
        }
    }
}
