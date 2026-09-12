package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.membership.AccountMembership;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
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
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ⚠️ <b>THE WIRING TEST, and it is the only thing that actually covers it.</b>
 *
 * <p>{@code AccountAccessService} caches whether a household is Plus for 60 seconds, and a member
 * login is paused when it is not. {@code AccountPlanChangedListener} is what makes a real plan
 * change take effect immediately instead of a minute later. Its body is one line and could hardly
 * be wrong; what CAN be wrong — silently, with a 200 response and no log line — is the event never
 * reaching it, because {@code @TransactionalEventListener(AFTER_COMMIT)} discards anything
 * published while no transaction is active. That is exactly how phase 7a's invitation email came
 * to never send.
 *
 * <p><b>Nothing else covers this.</b> {@code MemberLoginPauseTest} drives the plan through
 * {@code /api/auth/test/billing-plan}, which deliberately calls {@code invalidateAccount} DIRECTLY
 * (that route is not transactional, so an event published from it would be dropped) — so it would
 * stay green with the listener deleted outright. {@code AccountPlanChangedListenerTest} calls the
 * listener method by hand and so proves nothing about delivery either. This test goes through
 * {@code applyStripeState}, the real production choke point, inside a real transaction.
 */
@DisplayName("a real plan change invalidates the cached access")
class PlanChangeInvalidatesAccessTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PlanChangeInvalidatesAccessTest.class);
    }

    @Autowired
    private SubscriptionService subscriptionService;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

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
    private TransactionTemplate transactionTemplate;

    @MockitoBean
    private EmailService emailService;

    @Test
    void soAMemberUnpausesOnTheNextRequestRatherThanAMinuteLater() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);

        Account account = accountRepository.save(new Account("Household " + suffix));
        User member = userRepository.save(new User("member-" + suffix + "@example.com", "hash"));
        Person person = personRepository.save(new Person(account, "Sam", false));
        AccountMembership membership = membershipRepository.save(
                new AccountMembership(account, member, person, AccountRole.MEMBER));

        // Start Plus (comped is Plus through the same single derivation a paying household uses),
        // then prime the cache by resolving once.
        Subscription subscription = subscriptionService.getOrCreate(account);
        subscription.setComped(true);
        subscriptionRepository.save(subscription);

        AccountAccess whilePro = resolve(member, account);
        assertThat(whilePro.accountIsPro()).isTrue();

        // Now the real production path: a Stripe state that is NOT entitled, applied through the
        // one method the webhook, the billing controller and the reconciliation watchdog all use.
        transactionTemplate.executeWithoutResult(status -> {
            Subscription current = subscriptionService.findByAccountId(account.getId()).orElseThrow();
            current.setComped(false);
            subscriptionService.applyStripeState(current, new StripeSubscriptionState(
                    "cus_" + suffix, "sub_" + suffix, "price_" + suffix,
                    SubscriptionStatus.CANCELED, BillingInterval.MONTH,
                    // A period that ended yesterday: cancelled AND past its paid window, which is
                    // the one combination isPlus answers false for.
                    Instant.now().minus(1, ChronoUnit.DAYS), false));
        });

        // ⚠️ Without the listener this still answers accountIsPro == true, from the cache entry
        // primed above, for another 60 seconds -- and the member keeps seeing "paused" after the
        // household has paid, which is precisely when somebody gives up.
        AccountAccess afterChange = resolve(member, account);
        assertThat(afterChange.accountIsPro()).isFalse();
        assertThat(afterChange.status()).isEqualTo(com.worktrac.backend.membership.MembershipStatus.PAUSED_PLAN);

        // Membership id is unchanged: the plan moved, nothing was revoked.
        assertThat(afterChange.membershipId()).isEqualTo(membership.getId());
    }

    private AccountAccess resolve(User user, Account account) {
        Optional<AccountAccess> access =
                accountAccessService.resolve(user.getId(), account.getId(), user.getTokenVersion());
        return access.orElseThrow(() -> new AssertionError("membership did not resolve"));
    }
}
