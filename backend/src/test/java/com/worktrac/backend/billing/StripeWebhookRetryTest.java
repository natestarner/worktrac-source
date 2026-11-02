package com.worktrac.backend.billing;

import com.stripe.exception.ApiConnectionException;
import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// A webhook we failed to apply must be applied when Stripe retries it. The "already seen" marker is
// committed before the apply, so a failure used to leave it behind -- and Stripe's retry was then
// answered 200 as a duplicate and dropped.
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.stripe.webhook-secret=whsec_test_only")
class StripeWebhookRetryTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, StripeWebhookRetryTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @MockitoBean
    private StripeService stripeService;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private SubscriptionService subscriptionService;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Test
    void anEventWeFailedToApplyIsAppliedWhenStripeRetriesIt() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account account = accountRepository.save(new Account("Household " + suffix));
        Subscription subscription = subscriptionService.getOrCreate(account);
        subscription.setStripeSubscriptionId("sub_" + suffix);
        subscriptionRepository.save(subscription);

        String eventId = "evt_" + suffix;
        when(stripeService.verifyWebhook(anyString(), anyString())).thenReturn(new StripeService.WebhookEvent(
                eventId, "customer.subscription.updated", account.getId().toString(), "cus_" + suffix, "sub_" + suffix));
        when(stripeService.fetchSubscriptionState("sub_" + suffix))
                .thenThrow(new ApiConnectionException("Stripe unreachable"))
                .thenReturn(new StripeSubscriptionState("cus_" + suffix, "sub_" + suffix, "price_" + suffix,
                        SubscriptionStatus.ACTIVE, BillingInterval.MONTH,
                        Instant.now().plus(30, ChronoUnit.DAYS), false));

        // First delivery: we can't reach Stripe to re-fetch, so we ask Stripe to retry.
        mockMvc.perform(post("/api/webhooks/stripe").header("Stripe-Signature", "t=1,v1=x").content("{}"))
                .andExpect(status().isServiceUnavailable());

        // Stripe's retry of the SAME event must be processed, not dropped as a duplicate.
        mockMvc.perform(post("/api/webhooks/stripe").header("Stripe-Signature", "t=1,v1=x").content("{}"))
                .andExpect(status().isOk());

        verify(stripeService, times(2)).fetchSubscriptionState("sub_" + suffix);
        assertThat(subscriptionRepository.findByAccountId(account.getId()).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.ACTIVE);

        // And a THIRD delivery, after a successful apply, is a genuine duplicate.
        mockMvc.perform(post("/api/webhooks/stripe").header("Stripe-Signature", "t=1,v1=x").content("{}"))
                .andExpect(status().isOk());
        verify(stripeService, times(2)).fetchSubscriptionState("sub_" + suffix);
    }
}
