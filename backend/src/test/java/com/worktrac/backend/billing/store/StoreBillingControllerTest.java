package com.worktrac.backend.billing.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.billing.BillingEvent;
import com.worktrac.backend.billing.BillingEventRepository;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.PlanSku;
import com.worktrac.backend.billing.StripeService;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.billing.store.appstore.AppStoreProvider;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.EmailTestSupport;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The In-App Purchase endpoints against a real database, with Apple replaced by a mock of its
// provider -- the only class that talks to Apple. Pins rules 1, 2 and 4 of
// docs/in-app-purchase-plan.md at the HTTP boundary, plus the store's own notifications.
@AutoConfigureMockMvc
class StoreBillingControllerTest extends AbstractIntegrationTest {

    private static final String TEST_KEY = "local-dev-only-e2e-test-key-do-not-use-elsewhere";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, StoreBillingControllerTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private BillingEventRepository billingEventRepository;

    @Autowired
    @Qualifier("emailTaskExecutor")
    private Executor emailTaskExecutor;

    @MockitoBean
    private AppStoreProvider appStore;

    @MockitoBean
    private StripeService stripeService;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private String email;
    private long accountId;

    @BeforeEach
    void setUp() throws Exception {
        when(appStore.source()).thenReturn(BillingSource.APP_STORE);
        when(appStore.isConfigured()).thenReturn(true);
        when(appStore.productIdFor(any())).thenAnswer(invocation ->
                "huddle." + invocation.getArgument(0, PlanSku.class).name().toLowerCase().replace('_', '.'));
        email = "store-" + UUID.randomUUID() + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                email, "Nate");
        token = registration.get("token").asText();
        accountId = registration.get("account").get("id").asLong();
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);
    }

    @AfterEach
    void drainEmail() {
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);
    }

    private ResultActions postJson(String path, String bearer, Object body) throws Exception {
        return mockMvc.perform(post(path)
                .header("Authorization", "Bearer " + bearer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ResultActions prepare(String bearer) throws Exception {
        return postJson("/api/billing/store/app-store/prepare", bearer, Map.of("plan", "PLUS", "interval", "YEAR"));
    }

    private ResultActions sync(String bearer, String... proofs) throws Exception {
        return postJson("/api/billing/store/app-store/sync", bearer, Map.of("proofs", List.of(proofs)));
    }

    private Subscription row() {
        return subscriptionRepository.findByAccountId(accountId).orElseThrow();
    }

    private List<BillingEvent> events(BillingEventType type) {
        return billingEventRepository.findByAccountIdOrderByCreatedAtDesc(accountId).stream()
                .filter(event -> event.getEventType() == type).toList();
    }

    private StoreSubscriptionState appleActive(String originalTransactionId, UUID accountToken, PlanSku sku) {
        return new StoreSubscriptionState(BillingSource.APP_STORE, originalTransactionId,
                "huddle." + sku.name().toLowerCase().replace('_', '.'), sku, SubscriptionStatus.ACTIVE,
                Instant.now().plus(Duration.ofDays(365)), false, StoreEnvironment.SANDBOX, accountToken);
    }

    // A verified purchase stamped with `token`, whose current state Apple reports as `state`.
    private void apple(String proof, StoreSubscriptionState state) throws Exception {
        StorePurchaseReference reference = state.reference();
        when(appStore.verifyPurchase(proof)).thenReturn(reference);
        when(appStore.fetchState(eq(reference))).thenReturn(state);
    }

    @Test
    void productsAreTheTenSkusInThisEnvironmentsIds() throws Exception {
        mockMvc.perform(get("/api/billing/store/app-store/products").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(PlanSku.values().length))
                .andExpect(jsonPath("$[?(@.plan=='PLUS' && @.interval=='YEAR')].productId").value("huddle.plus.year"));
    }

    @Test
    void anUnknownStoreIs404AndAnUnconfiguredOneIs503() throws Exception {
        mockMvc.perform(get("/api/billing/store/nowhere/products").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        when(appStore.isConfigured()).thenReturn(false);
        prepare(token).andExpect(status().isServiceUnavailable());
    }

    @Nested
    class Prepare {

        @Test
        void answersTheProductAndTheHouseholdsLastingToken() throws Exception {
            JsonNode first = objectMapper.readTree(prepare(token).andExpect(status().isOk())
                    .andExpect(jsonPath("$.productId").value("huddle.plus.year"))
                    .andReturn().getResponse().getContentAsString());
            UUID accountToken = UUID.fromString(first.get("accountToken").asText());
            assertThat(row().getStoreAccountToken()).isEqualTo(accountToken);
            assertThat(events(BillingEventType.STORE_PURCHASE_STARTED)).hasSize(1);

            postJson("/api/billing/store/app-store/release", token, Map.of()).andExpect(status().isNoContent());
            JsonNode again = objectMapper.readTree(prepare(token).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());
            assertThat(again.get("accountToken").asText()).isEqualTo(accountToken.toString());
        }

        // Rule 2: two devices, one household, the same minute.
        @Test
        void aSecondDeviceIsRefusedWhileAPurchaseIsInProgress() throws Exception {
            prepare(token).andExpect(status().isOk());
            prepare(token).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("another device")));

            postJson("/api/billing/store/app-store/release", token, Map.of()).andExpect(status().isNoContent());
            prepare(token).andExpect(status().isOk());
        }

        // Rule 1: a household paying on the web is told where its plan lives, with no link.
        @Test
        void refusesAHouseholdPayingOnTheWeb() throws Exception {
            Subscription subscription = row();
            subscription.setBillingSource(BillingSource.STRIPE);
            subscription.setStripeSubscriptionId("sub_" + UUID.randomUUID());
            subscription.setStatus(SubscriptionStatus.ACTIVE);
            subscription.setPlan(BillingPlan.PLUS);
            subscriptionRepository.save(subscription);

            prepare(token).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message").value(
                            "This household's plan is billed on huddle.fitness. Sign in there to change it."));
        }

        @Test
        void refusesAHouseholdAlreadyPayingThroughTheAppStore() throws Exception {
            Subscription subscription = row();
            subscription.setBillingSource(BillingSource.APP_STORE);
            subscription.setStoreSubscriptionId("1000");
            subscription.setStatus(SubscriptionStatus.ACTIVE);
            subscription.setPlan(BillingPlan.PLUS);
            subscriptionRepository.save(subscription);

            prepare(token).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Manage subscription")));
        }

        @Test
        void refusesAComp() throws Exception {
            Subscription subscription = row();
            subscription.setComped(true);
            subscriptionRepository.save(subscription);
            prepare(token).andExpect(status().isConflict());
        }

        @Test
        void refusesSomethingWeDoNotSell() throws Exception {
            postJson("/api/billing/store/app-store/prepare", token,
                    Map.of("plan", "PLUS", "band", "STUDIO", "interval", "YEAR"))
                    .andExpect(status().isBadRequest());
        }

        // Only the owner may start a purchase, exactly as for Stripe.
        @Test
        void aMemberMayNotStartOne() throws Exception {
            mockMvc.perform(post("/api/auth/test/billing-plan").header("X-E2E-Test-Key", TEST_KEY)
                    .param("email", email).param("plan", "PLUS")).andExpect(status().isNoContent());
            mockMvc.perform(post("/api/people").header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))).andExpect(status().isOk());
            String memberEmail = "store-member-" + UUID.randomUUID() + "@example.com";
            mockMvc.perform(post("/api/auth/test/member").header("X-E2E-Test-Key", TEST_KEY)
                    .param("ownerEmail", email).param("personName", "Sam")
                    .param("memberEmail", memberEmail).param("password", "password123"))
                    .andExpect(status().isNoContent());
            String memberToken = objectMapper.readTree(mockMvc.perform(post("/api/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("email", memberEmail, "password", "password123"))))
                    .andReturn().getResponse().getContentAsString()).get("token").asText();

            prepare(memberToken).andExpect(status().isForbidden());
        }
    }

    @Nested
    class Sync {

        @Test
        void aPurchaseUnlocksThePlanAndSaysWhoBillsIt() throws Exception {
            UUID accountToken = UUID.fromString(objectMapper.readTree(prepare(token)
                    .andReturn().getResponse().getContentAsString()).get("accountToken").asText());
            apple("jws-1", appleActive("1000" + accountId, accountToken, PlanSku.PLUS_YEAR));

            sync(token, "jws-1").andExpect(status().isOk())
                    .andExpect(jsonPath("$.plan").value("PLUS"))
                    .andExpect(jsonPath("$.billingSource").value("APP_STORE"));

            Subscription subscription = row();
            assertThat(subscription.getStoreSubscriptionId()).isEqualTo("1000" + accountId);
            assertThat(subscription.getStoreEnvironment()).isEqualTo(StoreEnvironment.SANDBOX);
            // The purchase landed, so the one-at-a-time claim is gone.
            assertThat(subscription.getStorePurchaseStartedAt()).isNull();
            assertThat(events(BillingEventType.STORE_APPLIED)).hasSize(1);
        }

        // Rule 4: never "whoever is signed in". A phone signed in to ANOTHER household restoring an
        // Apple ID that pays for this one re-syncs this one and changes nothing over there.
        @Test
        void aProofIsAppliedToTheHouseholdItNamesNotTheCaller() throws Exception {
            UUID accountToken = UUID.fromString(objectMapper.readTree(prepare(token)
                    .andReturn().getResponse().getContentAsString()).get("accountToken").asText());
            apple("jws-2", appleActive("2000" + accountId, accountToken, PlanSku.PLUS_MONTH));

            JsonNode other = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                    "store-other-" + UUID.randomUUID() + "@example.com", "Ana");
            long otherAccount = other.get("account").get("id").asLong();

            sync(other.get("token").asText(), "jws-2").andExpect(status().isOk())
                    .andExpect(jsonPath("$.plan").value("FREE"));

            assertThat(row().getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(subscriptionRepository.findByAccountId(otherAccount).orElseThrow().getBillingSource()).isNull();
        }

        @Test
        void aPurchaseNamingNoHouseholdIsRecordedNotApplied() throws Exception {
            apple("jws-3", appleActive("3000" + accountId, UUID.randomUUID(), PlanSku.PLUS_MONTH));

            sync(token, "jws-3").andExpect(status().isOk()).andExpect(jsonPath("$.plan").value("FREE"));

            assertThat(billingEventRepository.findAll()).anyMatch(event ->
                    event.getEventType() == BillingEventType.STORE_UNMATCHED
                            && event.getDetail().contains("3000" + accountId));
        }

        // Bought on the App Store page (streamlined purchasing), so no household token: an owner who
        // opens the app on that phone, in a household nobody pays for, adopts it -- and Apple is asked
        // to stamp the household's token on it so renewals carry it.
        @Test
        void aTokenlessPurchaseReportedByAFreeHouseholdsOwnerIsAdoptedAndStamped() throws Exception {
            StoreSubscriptionState state = appleActive("8000" + accountId, null, PlanSku.PLUS_YEAR);
            apple("jws-8", state);

            sync(token, "jws-8").andExpect(status().isOk())
                    .andExpect(jsonPath("$.plan").value("PLUS"))
                    .andExpect(jsonPath("$.billingSource").value("APP_STORE"));

            UUID householdToken = row().getStoreAccountToken();
            assertThat(householdToken).isNotNull();
            verify(appStore).stampAccountToken(eq(state.reference()), eq(householdToken));
        }

        // Never into a household someone is already paying for: that would be a second subscription.
        @Test
        void aTokenlessPurchaseIsNotAdoptedByAHouseholdThatIsAlreadyPaid() throws Exception {
            Subscription subscription = row();
            subscription.setComped(true);
            subscriptionRepository.save(subscription);
            apple("jws-9", appleActive("9000" + accountId, null, PlanSku.PLUS_YEAR));

            sync(token, "jws-9").andExpect(status().isOk());

            assertThat(row().getStoreSubscriptionId()).isNull();
            verify(appStore, never()).stampAccountToken(any(), any());
            assertThat(billingEventRepository.findAll()).anyMatch(event ->
                    event.getEventType() == BillingEventType.STORE_UNMATCHED
                            && event.getDetail().contains("9000" + accountId));
        }

        // A notification is the store talking, not anyone in a household: it never adopts.
        @Test
        void aTokenlessPurchaseArrivingAsANotificationIsNotAdopted() throws Exception {
            StoreSubscriptionState state = appleActive("9100" + accountId, null, PlanSku.PLUS_YEAR);
            when(appStore.parseNotification(anyString())).thenReturn(Optional.of(state.reference()));
            when(appStore.fetchState(any())).thenReturn(state);

            mockMvc.perform(post("/api/webhooks/store/app-store").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"signedPayload\":\"x\"}")).andExpect(status().isOk());

            assertThat(row().getStoreSubscriptionId()).isNull();
            verify(appStore, never()).stampAccountToken(any(), any());
        }

        // Permanent: the app may finish it rather than retry forever.
        @Test
        void aProofThatDoesNotVerifyIsRecordedAndTheRequestStillSucceeds() throws Exception {
            when(appStore.verifyPurchase("forged")).thenThrow(new StoreVerificationException("bad signature"));
            sync(token, "forged").andExpect(status().isOk());
            assertThat(events(BillingEventType.STORE_REJECTED)).hasSize(1);
        }

        // The online certificate check couldn't complete: transient, never recorded as a forgery.
        @Test
        void aProofWhoseCertificateCheckCouldNotCompleteIs503() throws Exception {
            when(appStore.verifyPurchase("jws-ocsp")).thenThrow(new StoreBillingException("OCSP unreachable"));
            sync(token, "jws-ocsp").andExpect(status().isServiceUnavailable());
            assertThat(events(BillingEventType.STORE_REJECTED)).isEmpty();
        }

        // Transient: 503, so the app keeps the transaction unfinished and StoreKit hands it back.
        @Test
        void appleUnreachableIs503SoTheAppSendsItAgain() throws Exception {
            StorePurchaseReference reference = new StorePurchaseReference(BillingSource.APP_STORE, "4000",
                    StoreEnvironment.PRODUCTION, UUID.randomUUID(), "huddle.plus.year");
            when(appStore.verifyPurchase("jws-4")).thenReturn(reference);
            when(appStore.fetchState(any())).thenThrow(new StoreBillingException("down"));
            sync(token, "jws-4").andExpect(status().isServiceUnavailable());
        }

        // Rule 5, end to end: a web subscription and an App Store one. Apple stays; Stripe is
        // cancelled and refunded after commit, and the owner is told once.
        @Test
        void anAppStorePurchaseOverAStripeSubscriptionRefundsStripe() throws Exception {
            Subscription subscription = row();
            subscription.setBillingSource(BillingSource.STRIPE);
            String stripeId = "sub_" + UUID.randomUUID();
            subscription.setStripeSubscriptionId(stripeId);
            subscription.setStatus(SubscriptionStatus.ACTIVE);
            subscription.setPlan(BillingPlan.PLUS);
            subscription.setStoreAccountToken(UUID.randomUUID());
            subscriptionRepository.save(subscription);
            when(stripeService.cancelAndRefundLatestPayment(stripeId)).thenReturn("Stripe " + stripeId + " cancelled");

            apple("jws-5", appleActive("5000" + accountId, subscription.getStoreAccountToken(), PlanSku.PLUS_YEAR));
            sync(token, "jws-5").andExpect(status().isOk()).andExpect(jsonPath("$.billingSource").value("APP_STORE"));
            // A second message about the same overlap: refunded idempotently, owner told once.
            sync(token, "jws-5").andExpect(status().isOk());

            EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);
            verify(stripeService, org.mockito.Mockito.atLeastOnce()).cancelAndRefundLatestPayment(stripeId);
            verify(emailService, org.mockito.Mockito.times(1)).sendBillingNotice(eq(email),
                    eq("We refunded a duplicate Huddle subscription"), anyString());
        }
    }

    @Nested
    class Notifications {

        private ResultActions notify(String body) throws Exception {
            return mockMvc.perform(post("/api/webhooks/store/app-store")
                    .contentType(MediaType.APPLICATION_JSON).content(body));
        }

        @Test
        void anUnconfiguredStoreRejectsEverything() throws Exception {
            when(appStore.isConfigured()).thenReturn(false);
            notify("{\"signedPayload\":\"x\"}").andExpect(status().isUnauthorized());
            verify(appStore, never()).parseNotification(anyString());
        }

        @Test
        void oneThatDoesNotVerifyIs401() throws Exception {
            when(appStore.parseNotification(anyString())).thenThrow(new StoreVerificationException("forged"));
            notify("{\"signedPayload\":\"x\"}").andExpect(status().isUnauthorized());
        }

        // Apple's online certificate check couldn't complete: not a forgery, so Apple is asked to retry.
        @Test
        void aCertificateCheckThatCouldNotCompleteIs503NotRejected() throws Exception {
            when(appStore.parseNotification(anyString())).thenThrow(new StoreBillingException("OCSP unreachable"));
            notify("{\"signedPayload\":\"x\"}").andExpect(status().isServiceUnavailable());
            assertThat(billingEventRepository.findAll())
                    .noneMatch(event -> event.getEventType() == BillingEventType.STORE_REJECTED
                            && event.getDetail().contains("OCSP unreachable"));
        }

        @Test
        void aTestNotificationIsAcknowledged() throws Exception {
            when(appStore.parseNotification(anyString())).thenReturn(Optional.empty());
            notify("{\"signedPayload\":\"test\"}").andExpect(status().isOk());
        }

        // A renewal with no app open: found by the subscription id the household already holds.
        @Test
        void aRenewalIsAppliedToTheHouseholdThatHoldsTheSubscription() throws Exception {
            Subscription subscription = row();
            subscription.setBillingSource(BillingSource.APP_STORE);
            subscription.setStoreSubscriptionId("6000" + accountId);
            subscription.setStoreEnvironment(StoreEnvironment.PRODUCTION);
            subscription.setStatus(SubscriptionStatus.ACTIVE);
            subscription.setPlan(BillingPlan.PLUS);
            subscription.setCurrentPeriodEnd(Instant.now().plus(Duration.ofDays(1)));
            subscriptionRepository.save(subscription);

            StoreSubscriptionState renewed = new StoreSubscriptionState(BillingSource.APP_STORE, "6000" + accountId,
                    "huddle.pro.starter.month", PlanSku.PRO_STARTER_MONTH, SubscriptionStatus.ACTIVE,
                    Instant.now().plus(Duration.ofDays(31)), false, StoreEnvironment.PRODUCTION, null);
            when(appStore.parseNotification(anyString())).thenReturn(Optional.of(renewed.reference()));
            when(appStore.fetchState(any())).thenReturn(renewed);

            notify("{\"signedPayload\":\"renewal\"}").andExpect(status().isOk());

            assertThat(row().getPlan()).isEqualTo(BillingPlan.PRO);
        }

        @Test
        void appleUnreachableIs503SoAppleDeliversAgain() throws Exception {
            when(appStore.parseNotification(anyString())).thenReturn(Optional.of(new StorePurchaseReference(
                    BillingSource.APP_STORE, "7000", StoreEnvironment.PRODUCTION, null, null)));
            when(appStore.fetchState(any())).thenThrow(new StoreBillingException("down"));
            notify("{\"signedPayload\":\"x\"}").andExpect(status().isServiceUnavailable());
        }
    }
}
