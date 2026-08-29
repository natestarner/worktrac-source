package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.config.CompedAccountProperties;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Founding households keep Pro free. A plain unit test -- this is list handling plus one flag, and
// none of it needs a database.
class CompBootstrapTest {

    private UserRepository userRepository;
    private SubscriptionRepository subscriptionRepository;
    private SubscriptionService subscriptionService;
    private CompedAccountProperties properties;
    private CompBootstrap bootstrap;
    private Account account;
    private Subscription subscription;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        subscriptionRepository = mock(SubscriptionRepository.class);
        MutableClock clock = new MutableClock();
        subscriptionService = mock(SubscriptionService.class);
        properties = new CompedAccountProperties();
        bootstrap = new CompBootstrap(userRepository, subscriptionRepository, subscriptionService, properties);

        account = new Account("Founding Household");
        subscription = new Subscription(account, clock.instant());
        when(subscriptionService.getOrCreate(any())).thenReturn(subscription);
        when(subscriptionRepository.findByCompedTrue()).thenReturn(List.of());
    }

    private void registerUser(String email) {
        User user = new User(account, email, "hash");
        when(userRepository.findByEmail(email)).thenReturn(Optional.of(user));
    }

    @Test
    void compsAListedHousehold() {
        properties.setCompedEmails(List.of("founder@example.com"));
        registerUser("founder@example.com");

        bootstrap.run(null);

        assertThat(subscription.isComped()).isTrue();
        assertThat(subscription.getPlan()).isEqualTo(BillingPlan.PRO);
    }

    // The list is written by a human into an env var, so it will arrive with stray whitespace and
    // inconsistent casing sooner or later. Neither should cost someone their comp.
    @Test
    void matchesRegardlessOfCaseAndWhitespace() {
        properties.setCompedEmails(List.of("  Founder@Example.COM  "));
        registerUser("founder@example.com");

        bootstrap.run(null);

        assertThat(subscription.isComped()).isTrue();
    }

    // Not an error. This runs on every startup, so a founding household that has not registered
    // yet is simply comped whenever they do.
    @Test
    void ignoresAnEmailThatHasNotRegisteredYet() {
        properties.setCompedEmails(List.of("notyet@example.com"));
        when(userRepository.findByEmail("notyet@example.com")).thenReturn(Optional.empty());

        bootstrap.run(null);

        verify(subscriptionRepository, never()).save(any());
    }

    @Test
    void doesNothingWhenNoEmailsAreConfigured() {
        properties.setCompedEmails(List.of());

        bootstrap.run(null);

        verify(userRepository, never()).findByEmail(any());
        verify(subscriptionRepository, never()).save(any());
    }

    // An already-comped household is left alone rather than re-saved on every boot.
    @Test
    void isIdempotentAcrossRestarts() {
        subscription.setComped(true);
        properties.setCompedEmails(List.of("founder@example.com"));
        registerUser("founder@example.com");

        bootstrap.run(null);

        verify(subscriptionRepository, never()).save(any());
        assertThat(subscription.isComped()).isTrue();
    }

    // ⚠️ THE ONE THAT MATTERS. Losing a comp costs someone their whole training history behind a
    // paywall, with no warning and no purchase to point at. That must never happen as a side
    // effect of an edited environment variable, or of a deploy where the secret was momentarily
    // unset -- so drift is logged, never corrected.
    @Test
    void neverRevokesAnExistingCompWhenTheListShrinks() {
        Subscription alreadyComped = subscription;
        alreadyComped.setComped(true);
        when(subscriptionRepository.findByCompedTrue()).thenReturn(List.of(alreadyComped));
        when(userRepository.findByAccount_Id(any()))
                .thenReturn(Optional.of(new User(account, "dropped@example.com", "hash")));
        // A different household entirely is configured; the comped one is no longer listed.
        properties.setCompedEmails(List.of("someone-else@example.com"));
        when(userRepository.findByEmail("someone-else@example.com")).thenReturn(Optional.empty());

        bootstrap.run(null);

        assertThat(alreadyComped.isComped())
                .as("a comp must survive being dropped from the list")
                .isTrue();
    }
}
