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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /api/billing/portal-session: where Stripe's Customer Portal sends its "Return to Huddle".
// The web keeps the configured return URL; the App Store app, which shows the portal in an in-app
// browser sheet, asks for a page that tells the person to close the sheet instead.
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.stripe.secret-key=sk_test_portal_session",
        "app.stripe.publishable-key=pk_test_portal_session",
        "app.stripe.return-url=https://app.example.test/app/billing",
})
class PortalSessionTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PortalSessionTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @MockitoBean
    private StripeService stripeService;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private String customerId;

    @BeforeEach
    void setUp() throws Exception {
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                "portal-session-" + UUID.randomUUID() + "@example.com", "Nate");
        token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        when(stripeService.isConfigured()).thenReturn(true);
        // A household that has paid before, so it has a Stripe customer to manage. One per household:
        // the tests share a database, and stripe_customer_id is unique.
        customerId = "cus_" + UUID.randomUUID();
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStripeCustomerId(customerId);
        subscriptionRepository.save(subscription);
        when(stripeService.createPortalSession(anyString(), anyString())).thenReturn("https://billing.stripe.com/p/session_1");
    }

    // The web, and every app build that predates the parameter: unchanged.
    @Test
    void returnsToTheBillingScreenByDefault() throws Exception {
        mockMvc.perform(post("/api/billing/portal-session").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("https://billing.stripe.com/p/session_1"));

        verify(stripeService).createPortalSession(eq(customerId), eq("https://app.example.test/app/billing"));
    }

    // Inside the app's browser sheet /app/billing is a signed-out web app; the landing page says
    // to tap Done, which closes the sheet onto the app.
    @Test
    void returnsTheAppToAPageThatSaysToCloseTheSheet() throws Exception {
        mockMvc.perform(post("/api/billing/portal-session").param("returnTo", "app")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        verify(stripeService).createPortalSession(eq(customerId), eq("https://app.example.test/billing-done"));
    }

    // Only the one value means anything; an unknown one is the web's behaviour, never an error.
    @Test
    void ignoresAnUnknownReturnTo() throws Exception {
        mockMvc.perform(post("/api/billing/portal-session").param("returnTo", "somewhere-else")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        verify(stripeService).createPortalSession(eq(customerId), eq("https://app.example.test/app/billing"));
    }
}
