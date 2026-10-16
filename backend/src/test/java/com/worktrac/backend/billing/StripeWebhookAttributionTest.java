package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.config.StripeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.Optional;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Which household a webhook belongs to must NOT depend on the API version the event arrives in.
//
// That version is set by the webhook ENDPOINT's configuration in the Stripe Dashboard, not by this
// code, and stripe-java's typed models only deserialize an event from the SDK's own release train
// (EventDataObjectDeserializer.getObject() is empty otherwise). Attribution built on those models
// meant the 33 -> 34 SDK bump (dahlia -> endive) would have turned every renewal, cancellation and
// failed payment into "could not attribute" until each endpoint was upgraded by hand. CI never saw
// it: every other billing test mocks StripeService wholesale.
//
// So this drives the REAL controller and the REAL StripeService with genuinely signed events, at
// the train before the SDK's, the SDK's own, and one that does not exist yet. Only the network
// call (re-fetching the subscription) and the persistence layer are stubbed.
class StripeWebhookAttributionTest {

    private static final String WEBHOOK_SECRET = "whsec_test_secret_for_attribution_only";
    private static final Long ACCOUNT_ID = 42L;

    static Stream<String> apiVersions() {
        return Stream.of("2026-08-26.dahlia", "2026-09-30.endive", "2027-03-31.fig");
    }

    private final StripeSubscriptionState fetched = new StripeSubscriptionState(
            "cus_1", "sub_1", "price_1", SubscriptionStatus.ACTIVE, BillingInterval.MONTH,
            Instant.parse("2026-11-16T00:00:00Z"), false);

    private StripeService stripeService;
    private SubscriptionService subscriptionService;
    private SubscriptionRepository subscriptionRepository;
    private BillingAuditService auditService;
    private StripeWebhookController controller;

    @BeforeEach
    void setUp() throws Exception {
        StripeProperties properties = new StripeProperties();
        properties.setWebhookSecret(WEBHOOK_SECRET);
        stripeService = spy(new StripeService(properties));
        doReturn(fetched).when(stripeService).fetchSubscriptionState(any());

        subscriptionService = mock(SubscriptionService.class);
        subscriptionRepository = mock(SubscriptionRepository.class);
        auditService = mock(BillingAuditService.class);
        when(auditService.recordIfFirstSeen(any(), any(), any(), any())).thenReturn(true);

        controller = new StripeWebhookController(stripeService, properties, subscriptionService,
                subscriptionRepository, auditService, mock(AccountRepository.class));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("apiVersions")
    void aSubscriptionEventIsAttributedFromItsMetadata(String apiVersion) throws Exception {
        Subscription local = localSubscription("sub_1");
        when(subscriptionRepository.findByAccountId(ACCOUNT_ID)).thenReturn(Optional.of(local));

        ResponseEntity<?> response = deliver(apiVersion, "customer.subscription.updated",
                "{\"id\":\"sub_1\",\"object\":\"subscription\",\"customer\":\"cus_1\","
                        + "\"metadata\":{\"accountId\":\"42\"}}");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(auditService).recordIfFirstSeen(eq(ACCOUNT_ID), eq("evt_1"),
                eq(BillingEventType.WEBHOOK_APPLIED), any());
        verify(subscriptionService).applyStripeState(local, fetched);
    }

    // The first event for a fresh checkout: the local row has not recorded a subscription id yet,
    // so the one to re-fetch has to come from the session in the payload.
    @ParameterizedTest(name = "{0}")
    @MethodSource("apiVersions")
    void aCompletedCheckoutNamesTheSubscriptionToReFetch(String apiVersion) throws Exception {
        Subscription local = localSubscription(null);
        when(subscriptionRepository.findByAccountId(ACCOUNT_ID)).thenReturn(Optional.of(local));

        deliver(apiVersion, "checkout.session.completed",
                "{\"id\":\"cs_1\",\"object\":\"checkout.session\",\"customer\":\"cus_1\","
                        + "\"subscription\":\"sub_1\",\"metadata\":{\"accountId\":\"42\"}}");

        verify(stripeService).fetchSubscriptionState("sub_1");
        verify(subscriptionService).applyStripeState(local, fetched);
    }

    // Portal-initiated changes and invoices do not carry our metadata, so the customer id is the
    // fallback that names the household.
    @ParameterizedTest(name = "{0}")
    @MethodSource("apiVersions")
    void anInvoiceWithNoMetadataIsAttributedThroughItsCustomer(String apiVersion) throws Exception {
        Subscription local = localSubscription("sub_1");
        when(subscriptionRepository.findByStripeCustomerId("cus_1")).thenReturn(Optional.of(local));
        when(subscriptionRepository.findByAccountId(ACCOUNT_ID)).thenReturn(Optional.of(local));

        deliver(apiVersion, "invoice.paid", "{\"id\":\"in_1\",\"object\":\"invoice\",\"customer\":\"cus_1\"}");

        verify(auditService).recordIfFirstSeen(eq(ACCOUNT_ID), eq("evt_1"),
                eq(BillingEventType.WEBHOOK_APPLIED), any());
        verify(subscriptionService).applyStripeState(local, fetched);
    }

    private ResponseEntity<?> deliver(String apiVersion, String type, String dataObject) {
        String payload = "{\"id\":\"evt_1\",\"object\":\"event\",\"api_version\":\"" + apiVersion + "\","
                + "\"type\":\"" + type + "\",\"data\":{\"object\":" + dataObject + "}}";
        String header = StripeWebhookSignatureTest.signatureHeader(payload, Instant.now(), WEBHOOK_SECRET);
        return controller.receive(header, payload);
    }

    private static Subscription localSubscription(String stripeSubscriptionId) {
        Account account = mock(Account.class);
        when(account.getId()).thenReturn(ACCOUNT_ID);
        Subscription subscription = mock(Subscription.class);
        when(subscription.getAccount()).thenReturn(account);
        when(subscription.getStripeSubscriptionId()).thenReturn(stripeSubscriptionId);
        return subscription;
    }
}
