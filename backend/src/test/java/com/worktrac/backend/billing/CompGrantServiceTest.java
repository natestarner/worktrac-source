package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.membership.AccountMembership;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.membership.MembershipStatus;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The admin portal's plan-granting action, end to end through the real service.
 *
 * <p>Two things here are load-bearing beyond the obvious happy path:
 *
 * <ul>
 *   <li><b>The member actually unpauses</b>, resolved through {@code AccountAccessService} rather
 *       than read back off the row. That cache answers for 60 seconds, so a grant that writes the
 *       right columns and fails to invalidate looks completely correct in a repository assertion
 *       and leaves the household staring at "your login is paused" after being given Plus.</li>
 *   <li><b>No {@code PlusUpgradedEvent} is published</b>, asserted against recorded events rather
 *       than a mock's interactions -- the welcome email goes out through an {@code @Async}
 *       {@code AFTER_COMMIT} listener, so {@code verifyNoInteractions} would pass whether or not
 *       the event was published, simply by running first.</li>
 * </ul>
 */
@RecordApplicationEvents
@DisplayName("granting and removing a comp from the admin portal")
class CompGrantServiceTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CompGrantServiceTest.class);
    }

    private static final String ADMIN = "admin@example.com";

    @Autowired
    private CompGrantService compGrantService;

    @Autowired
    private SubscriptionService subscriptionService;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private BillingEventRepository billingEventRepository;

    @Autowired
    private AccountAccessService accountAccessService;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PersonRepository personRepository;

    @Autowired
    private AccountMembershipRepository membershipRepository;

    @Autowired
    private ApplicationEvents events;

    @MockitoBean
    private EmailService emailService;

    // --- granting -------------------------------------------------------------------------

    @Test
    @DisplayName("Plus reaches the member's live access, not just the row")
    void grantingPlusUnpausesAMemberImmediately() {
        Fixture fixture = newHousehold();

        // Prime the 60s cache while the household is still Free, so a missing invalidation would
        // genuinely be caught rather than being masked by a cold cache.
        AccountAccess whileFree = resolve(fixture);
        assertThat(whileFree.accountPlan()).isEqualTo(BillingPlan.FREE);
        assertThat(whileFree.status()).isEqualTo(MembershipStatus.PAUSED_PLAN);

        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, "Founding household", ADMIN);

        AccountAccess afterGrant = resolve(fixture);
        assertThat(afterGrant.accountPlan()).isEqualTo(BillingPlan.PLUS);
        assertThat(afterGrant.status()).isEqualTo(MembershipStatus.ACTIVE);
        // Nothing was revoked or recreated -- the same membership row, still there.
        assertThat(afterGrant.membershipId()).isEqualTo(fixture.membership.getId());
    }

    @Test
    @DisplayName("both comp columns and the cache column are written together")
    void grantingPlusWritesTheGrantAndItsCache() {
        Fixture fixture = newHousehold();

        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, "  Beta tester  ", ADMIN);

        Subscription row = reload(fixture);
        assertThat(row.isComped()).isTrue();
        assertThat(row.getCompedPlan()).isEqualTo(BillingPlan.PLUS);
        assertThat(row.getPlan()).isEqualTo(BillingPlan.PLUS);
        // A household tier has no seats at all.
        assertThat(row.getClientSeats()).isNull();
        assertThat(row.getCompNote()).isEqualTo("Beta tester");
    }

    @Test
    @DisplayName("Pro writes the band's ceiling as seats, in the same write as the tier")
    void grantingProCarriesTheBandsSeats() {
        Fixture fixture = newHousehold();

        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.STUDIO, null, ADMIN);

        Subscription row = reload(fixture);
        assertThat(row.getCompedPlan()).isEqualTo(BillingPlan.PRO);
        assertThat(row.getClientSeats()).isEqualTo(ClientBand.STUDIO.clientLimit());
        assertThat(subscriptionService.entitledPlan(fixture.account.getId())).isEqualTo(BillingPlan.PRO);
    }

    @Test
    @DisplayName("the unlimited band keeps seats null rather than inventing a sentinel")
    void grantingProUnlimitedLeavesSeatsNull() {
        Fixture fixture = newHousehold();

        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.UNLIMITED, null, ADMIN);

        assertThat(reload(fixture).getClientSeats()).isNull();
    }

    @Test
    @DisplayName("granting again rewrites the grant, which is how a tier is changed")
    void grantingOverAnExistingCompReplacesIt() {
        Fixture fixture = newHousehold();
        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.PRACTICE, "trainer", ADMIN);

        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, "moved to Plus", ADMIN);

        Subscription row = reload(fixture);
        assertThat(row.getCompedPlan()).isEqualTo(BillingPlan.PLUS);
        // Seats travel with the tier: dropping to a household tier must clear them, or a Plus
        // household is reported a roster allowance it is not paying for.
        assertThat(row.getClientSeats()).isNull();
        assertThat(row.getCompNote()).isEqualTo("moved to Plus");
    }

    @Test
    @DisplayName("no welcome-to-Plus email is triggered -- nobody bought anything")
    void grantingDoesNotPublishPlusUpgraded() {
        Fixture fixture = newHousehold();

        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, null, ADMIN);

        assertThat(events.stream(PlusUpgradedEvent.class)).isEmpty();
        // The invalidation event IS published -- that asymmetry is the point, so assert both
        // directions rather than only the absence.
        assertThat(events.stream(AccountPlanChangedEvent.class)
                .filter(e -> e.accountId().equals(fixture.account.getId())))
                .isNotEmpty();
        assertThat(reload(fixture).getPlusWelcomeSentAt()).isNull();
    }

    // --- refusals -------------------------------------------------------------------------

    @Test
    @DisplayName("Free is refused: removing a grant is its own action with its own audit event")
    void grantingFreeIsRefused() {
        Fixture fixture = newHousehold();

        assertThatThrownBy(() -> compGrantService.grant(fixture.account.getId(), BillingPlan.FREE, null, null, ADMIN))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(reload(fixture).isComped()).isFalse();
    }

    @Test
    @DisplayName("a band is required for Pro and refused for every other tier")
    void theBandMustMatchTheTier() {
        Fixture fixture = newHousehold();

        assertThatThrownBy(() -> compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, null, null, ADMIN))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> compGrantService.grant(
                fixture.account.getId(), BillingPlan.PLUS, ClientBand.STARTER, null, ADMIN))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(reload(fixture).isComped()).isFalse();
    }

    @Test
    @DisplayName("an over-long note is refused, not silently clipped")
    void anOverLongNoteIsRefused() {
        Fixture fixture = newHousehold();
        String tooLong = "x".repeat(CompGrantService.MAX_NOTE_LENGTH + 1);

        assertThatThrownBy(() -> compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, tooLong, ADMIN))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(reload(fixture).isComped()).isFalse();
    }

    @Test
    @DisplayName("a household paying through Stripe is refused, so a comp cannot leave them charged")
    void aStripePayingHouseholdIsRefused() {
        Fixture fixture = newHousehold();
        payingThroughStripe(fixture);

        assertThatThrownBy(() -> compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.STUDIO, null, ADMIN))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Stripe");

        assertThat(reload(fixture).isComped()).isFalse();
    }

    @Test
    @DisplayName("an already-comped household stays editable even with a lapsed Stripe row beside it")
    void aLapsedStripeSubscriptionDoesNotBlockRegranting() {
        Fixture fixture = newHousehold();
        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, null, ADMIN);
        // A subscription that ended months ago. isEntitled answers TRUE for this row (it is
        // comped), so a gate asking isEntitled instead of isPayingThroughStripe would latch this
        // household out of its own grant forever.
        lapsedStripeSubscription(fixture);

        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.STARTER, null, ADMIN);

        assertThat(reload(fixture).getCompedPlan()).isEqualTo(BillingPlan.PRO);
    }

    @Test
    @DisplayName("an unknown household is a 404, never a silently-created one")
    void anUnknownAccountIsNotFound() {
        assertThatThrownBy(() -> compGrantService.grant(-1L, BillingPlan.PLUS, null, null, ADMIN))
                .isInstanceOf(NotFoundException.class);
    }

    // --- revoking -------------------------------------------------------------------------

    @Test
    @DisplayName("removing a grant returns the household to Free and re-pauses the member")
    void revokingReturnsTheHouseholdToFree() {
        Fixture fixture = newHousehold();
        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.STUDIO, "trial", ADMIN);
        assertThat(resolve(fixture).accountPlan()).isEqualTo(BillingPlan.PRO);

        compGrantService.revoke(fixture.account.getId(), ADMIN);

        Subscription row = reload(fixture);
        assertThat(row.isComped()).isFalse();
        assertThat(row.getCompedPlan()).isNull();
        assertThat(row.getCompNote()).isNull();
        // billing_plan is a cache of entitlement; leaving it reading PRO strands it.
        assertThat(row.getPlan()).isEqualTo(BillingPlan.FREE);
        assertThat(row.getClientSeats()).isNull();

        AccountAccess afterRevoke = resolve(fixture);
        assertThat(afterRevoke.accountPlan()).isEqualTo(BillingPlan.FREE);
        assertThat(afterRevoke.status()).isEqualTo(MembershipStatus.PAUSED_PLAN);
        // Nothing was deleted: the membership, the person and their history all survive.
        assertThat(afterRevoke.membershipId()).isEqualTo(fixture.membership.getId());
        assertThat(membershipRepository.findById(fixture.membership.getId())).isPresent();
        assertThat(personRepository.findById(fixture.person.getId())).isPresent();
    }

    @Test
    @DisplayName("removing a grant never cuts off a household that is genuinely paying")
    void revokingLeavesAPayingHouseholdEntitled() {
        Fixture fixture = newHousehold();
        compGrantService.grant(fixture.account.getId(), BillingPlan.PLUS, null, null, ADMIN);
        payingThroughStripe(fixture);

        compGrantService.revoke(fixture.account.getId(), ADMIN);

        Subscription row = reload(fixture);
        assertThat(row.isComped()).isFalse();
        // Recomputed, not clamped: they are still paying, so the tier the row records stands.
        assertThat(row.getPlan()).isEqualTo(BillingPlan.PLUS);
        assertThat(subscriptionService.entitledPlan(fixture.account.getId())).isEqualTo(BillingPlan.PLUS);
    }

    @Test
    @DisplayName("removing a grant that was never there is a no-op, not an error")
    void revokingAnUncompedHouseholdDoesNothing() {
        Fixture fixture = newHousehold();

        compGrantService.revoke(fixture.account.getId(), ADMIN);

        assertThat(reload(fixture).isComped()).isFalse();
        assertThat(auditFor(fixture)).isEmpty();
    }

    // --- the audit trail ------------------------------------------------------------------

    @Test
    @DisplayName("every grant and revoke names the acting admin in billing_events")
    void bothActionsAreAudited() {
        Fixture fixture = newHousehold();

        compGrantService.grant(fixture.account.getId(), BillingPlan.PRO, ClientBand.STARTER, "coaching pilot", ADMIN);
        compGrantService.revoke(fixture.account.getId(), ADMIN);

        List<BillingEvent> audit = auditFor(fixture);
        assertThat(audit).extracting(BillingEvent::getEventType)
                .containsExactlyInAnyOrder(BillingEventType.COMP_GRANTED, BillingEventType.COMP_REVOKED);

        BillingEvent granted = audit.stream()
                .filter(e -> e.getEventType() == BillingEventType.COMP_GRANTED)
                .findFirst().orElseThrow();
        // Who, what and why -- the three things a review of "why is this household on Pro?" asks.
        assertThat(granted.getDetail())
                .contains(ADMIN)
                .contains("PRO")
                .contains("STARTER")
                .contains("coaching pilot");

        BillingEvent revoked = audit.stream()
                .filter(e -> e.getEventType() == BillingEventType.COMP_REVOKED)
                .findFirst().orElseThrow();
        assertThat(revoked.getDetail()).contains(ADMIN).contains("PRO");
    }

    // --- fixtures -------------------------------------------------------------------------

    private record Fixture(Account account, User member, Person person, AccountMembership membership) {
    }

    private Fixture newHousehold() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account account = accountRepository.save(new Account("Household " + suffix));
        User member = userRepository.save(new User("member-" + suffix + "@example.com", "hash"));
        Person person = personRepository.save(new Person(account, "Sam", false));
        AccountMembership membership = membershipRepository.save(
                new AccountMembership(account, member, person, AccountRole.MEMBER));
        subscriptionService.getOrCreate(account);
        return new Fixture(account, member, person, membership);
    }

    /** A live Stripe subscription in good standing, written directly rather than through a webhook. */
    private void payingThroughStripe(Fixture fixture) {
        Subscription row = reload(fixture);
        row.setStripeSubscriptionId("sub_" + UUID.randomUUID());
        row.setStatus(SubscriptionStatus.ACTIVE);
        row.setPlan(BillingPlan.PLUS);
        row.setCurrentPeriodEnd(Instant.now().plus(30, ChronoUnit.DAYS));
        subscriptionRepository.save(row);
    }

    /** A Stripe subscription that ended long ago -- present, but paying for nothing. */
    private void lapsedStripeSubscription(Fixture fixture) {
        Subscription row = reload(fixture);
        row.setStripeSubscriptionId("sub_" + UUID.randomUUID());
        row.setStatus(SubscriptionStatus.CANCELED);
        row.setCurrentPeriodEnd(Instant.now().minus(90, ChronoUnit.DAYS));
        subscriptionRepository.save(row);
    }

    private Subscription reload(Fixture fixture) {
        return subscriptionRepository.findByAccountId(fixture.account.getId()).orElseThrow();
    }

    private List<BillingEvent> auditFor(Fixture fixture) {
        return billingEventRepository.findByAccountIdOrderByCreatedAtDesc(fixture.account.getId());
    }

    private AccountAccess resolve(Fixture fixture) {
        return accountAccessService
                .resolve(fixture.member.getId(), fixture.account.getId(), fixture.member.getTokenVersion())
                .orElseThrow(() -> new AssertionError("membership did not resolve"));
    }
}
