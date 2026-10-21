package com.worktrac.backend.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /api/billing/checkout-link: the App Store app's US-storefront checkout, a link out to
// Stripe's hosted page. What it must guarantee is that it is the SAME purchase as the web's embedded
// checkout -- same guards, same price mapping -- with only the page that takes the payment changed.
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.stripe.secret-key=sk_test_checkout_link",
        "app.stripe.publishable-key=pk_test_checkout_link",
        "app.stripe.return-url=https://app.example.test/app/billing",
        "app.stripe.prices.PLUS_MONTH=price_plus_month",
})
class CheckoutLinkTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CheckoutLinkTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private BillingEventRepository billingEventRepository;

    @MockitoBean
    private StripeService stripeService;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long accountId;
    private String customerId;

    @BeforeEach
    void setUp() throws Exception {
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                "checkout-link-" + UUID.randomUUID() + "@example.com", "Nate");
        token = registration.get("token").asText();
        accountId = registration.get("account").get("id").asLong();
        when(stripeService.isConfigured()).thenReturn(true);
        // One customer per household: the tests share a database, and stripe_customer_id is unique.
        customerId = "cus_" + UUID.randomUUID();
        when(stripeService.createCustomer(anyLong(), any(), any())).thenReturn(customerId);
        when(stripeService.createHostedCheckoutSession(anyLong(), anyString(), any(), anyString(), anyString()))
                .thenReturn(new StripeService.HostedCheckout("https://checkout.stripe.com/c/pay/cs_test_1", "cs_test_1"));
    }

    private org.springframework.test.web.servlet.ResultActions requestLink(Map<String, Object> body) throws Exception {
        return mockMvc.perform(post("/api/billing/checkout-link")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    @Test
    void answersWithTheHostedPageAndTheSessionIdTheAppWillReconcile() throws Exception {
        requestLink(Map.of("plan", "PLUS", "interval", "MONTH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("https://checkout.stripe.com/c/pay/cs_test_1"))
                .andExpect(jsonPath("$.sessionId").value("cs_test_1"));

        // Stripe lands the BROWSER on a page at the app's own origin -- derived from the embedded
        // checkout's return URL, so no new setting -- which tells the person to go back to the app.
        verify(stripeService).createHostedCheckoutSession(eq(accountId), eq(customerId),eq(PlanSku.PLUS_MONTH),
                eq("https://app.example.test/checkout-complete?session_id={CHECKOUT_SESSION_ID}"),
                eq("https://app.example.test/checkout-complete?cancelled=1"));
        verify(stripeService, never()).createEmbeddedCheckoutSession(anyLong(), anyString(), any());
    }

    // The app's upgrade funnel (billing.md): a link opened is a CHECKOUT_STARTED row marked hosted
    // and carrying its session id, so it can be joined to that session's CHECKOUT_RECONCILED row.
    @Test
    void recordsTheOpenedLinkForTheUpgradeFunnel() throws Exception {
        requestLink(Map.of("plan", "PLUS", "interval", "MONTH")).andExpect(status().isOk());

        assertThat(billingEventRepository.findByAccountIdOrderByCreatedAtDesc(accountId))
                .filteredOn(e -> e.getEventType() == BillingEventType.CHECKOUT_STARTED)
                .extracting(BillingEvent::getDetail)
                .containsExactly("sku=PLUS_MONTH hosted session=cs_test_1");
    }

    // The guard that stops a household paying twice applies to the link exactly as it does on the web.
    @Test
    void refusesAHouseholdThatIsAlreadyPaying() throws Exception {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setComped(true);
        subscriptionRepository.save(subscription);

        requestLink(Map.of("plan", "PLUS", "interval", "MONTH")).andExpect(status().isForbidden());
        verify(stripeService, never()).createHostedCheckoutSession(anyLong(), anyString(), any(), anyString(), anyString());
    }

    // Same price mapping as the web: a combination we do not sell is a 400, never a checkout.
    @Test
    void refusesSomethingWeDoNotSell() throws Exception {
        requestLink(Map.of("plan", "PLUS", "band", "STUDIO", "interval", "MONTH")).andExpect(status().isBadRequest());
    }

    // An environment that has no price for a tier refuses honestly rather than charging the wrong one.
    @Test
    void refusesATierThisEnvironmentDoesNotSell() throws Exception {
        requestLink(Map.of("plan", "PLUS", "interval", "YEAR")).andExpect(status().isServiceUnavailable());
    }
}
