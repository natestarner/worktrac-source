package com.worktrac.backend.billing.store.appstore;

import com.apple.itunes.storekit.model.AutoRenewStatus;
import com.apple.itunes.storekit.model.JWSRenewalInfoDecodedPayload;
import com.apple.itunes.storekit.model.JWSTransactionDecodedPayload;
import com.apple.itunes.storekit.model.Status;
import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.PlanSku;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.billing.store.StoreEnvironment;
import com.worktrac.backend.billing.store.StoreSubscriptionState;
import com.worktrac.backend.billing.store.StoreVerificationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// Apple's states onto ours (docs/in-app-purchase-plan.md, "How Apple's states map"), product ids, and
// that what does not verify is refused. Built from Apple's own payload types, so a library upgrade
// that renames or re-types one fails here, not in production.
//
// What this cannot cover without Apple: a real signed payload verifying. Phase 3 captures sandbox
// payloads; they verify offline against the bundled root certificate and belong here as fixtures.
class AppStoreProviderTest {

    private static final Instant EXPIRES = Instant.parse("2027-01-01T00:00:00Z");
    private static final Instant GRACE_END = Instant.parse("2027-01-17T00:00:00Z");
    private static final Instant REVOKED_AT = Instant.parse("2026-12-15T00:00:00Z");
    private static final UUID TOKEN = UUID.randomUUID();

    private AppStoreProvider provider;

    @BeforeEach
    void setUp() {
        AppStoreProperties properties = new AppStoreProperties();
        properties.setBundleId("fitness.huddle.app");
        properties.setAppAppleId(6826555272L);
        properties.setIssuerId("issuer");
        properties.setKeyId("KEYID");
        properties.setPrivateKey("-----BEGIN PRIVATE KEY-----\\nnot-a-key\\n-----END PRIVATE KEY-----");
        properties.setProductPrefix("huddle.");
        provider = new AppStoreProvider(properties);
    }

    private static JWSTransactionDecodedPayload transaction(String productId) {
        JWSTransactionDecodedPayload transaction = new JWSTransactionDecodedPayload();
        transaction.setOriginalTransactionId("2000000123");
        transaction.setProductId(productId);
        transaction.setExpiresDate(EXPIRES.toEpochMilli());
        transaction.setAppAccountToken(TOKEN);
        return transaction;
    }

    private static JWSRenewalInfoDecodedPayload renewal(AutoRenewStatus autoRenew) {
        JWSRenewalInfoDecodedPayload renewal = new JWSRenewalInfoDecodedPayload();
        renewal.setAutoRenewStatus(autoRenew);
        return renewal;
    }

    private StoreSubscriptionState map(Status status, JWSTransactionDecodedPayload transaction,
                                       JWSRenewalInfoDecodedPayload renewal) {
        return AppStoreProvider.toState(status, transaction, renewal, StoreEnvironment.SANDBOX,
                provider::skuForProductId);
    }

    @Test
    void productIdsDeriveFromTheSkuWithThePrefix() {
        assertThat(provider.productIdFor(PlanSku.PLUS_YEAR)).isEqualTo("huddle.plus.year");
        assertThat(provider.productIdFor(PlanSku.PRO_UNLIMITED_MONTH)).isEqualTo("huddle.pro.unlimited.month");
        for (PlanSku sku : PlanSku.values()) {
            assertThat(provider.skuForProductId(provider.productIdFor(sku))).contains(sku);
        }
        // Huddle Lower's products are not Huddle's.
        assertThat(provider.skuForProductId("huddle.lower.plus.year")).isEmpty();
    }

    @Test
    void activeAndRenewingIsActive() {
        StoreSubscriptionState state = map(Status.ACTIVE, transaction("huddle.pro.studio.year"),
                renewal(AutoRenewStatus.ON));
        assertThat(state.source()).isEqualTo(BillingSource.APP_STORE);
        assertThat(state.subscriptionId()).isEqualTo("2000000123");
        assertThat(state.status()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(state.currentPeriodEnd()).isEqualTo(EXPIRES);
        assertThat(state.cancelAtPeriodEnd()).isFalse();
        assertThat(state.sku()).isEqualTo(PlanSku.PRO_STUDIO_YEAR);
        assertThat(state.accountToken()).isEqualTo(TOKEN);
        assertThat(state.environment()).isEqualTo(StoreEnvironment.SANDBOX);
    }

    @Test
    void activeWithAutoRenewOffEndsAtThePeriodEnd() {
        StoreSubscriptionState state = map(Status.ACTIVE, transaction("huddle.plus.month"),
                renewal(AutoRenewStatus.OFF));
        assertThat(state.status()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(state.cancelAtPeriodEnd()).isTrue();
    }

    // Like Stripe retrying a card: still entitled, until the grace period ends.
    @Test
    void billingGracePeriodIsPastDueUntilTheGraceEnds() {
        JWSRenewalInfoDecodedPayload renewal = renewal(AutoRenewStatus.ON);
        renewal.setGracePeriodExpiresDate(GRACE_END.toEpochMilli());
        StoreSubscriptionState state = map(Status.BILLING_GRACE_PERIOD, transaction("huddle.plus.month"), renewal);
        assertThat(state.status()).isEqualTo(SubscriptionStatus.PAST_DUE);
        assertThat(state.currentPeriodEnd()).isEqualTo(GRACE_END);
    }

    @Test
    void billingRetryAfterTheGraceIsCancelledAtTheOldExpiry() {
        StoreSubscriptionState state = map(Status.BILLING_RETRY, transaction("huddle.plus.month"),
                renewal(AutoRenewStatus.ON));
        assertThat(state.status()).isEqualTo(SubscriptionStatus.CANCELED);
        assertThat(state.currentPeriodEnd()).isEqualTo(EXPIRES);
    }

    @Test
    void expiredIsCancelled() {
        StoreSubscriptionState state = map(Status.EXPIRED, transaction("huddle.plus.month"),
                renewal(AutoRenewStatus.OFF));
        assertThat(state.status()).isEqualTo(SubscriptionStatus.CANCELED);
        assertThat(state.cancelAtPeriodEnd()).isFalse();
    }

    // A refund ends the plan at once, not at the period end the person no longer paid for.
    @Test
    void aRevokedTransactionEndsAtTheRevocationEvenIfTheStatusLags() {
        JWSTransactionDecodedPayload transaction = transaction("huddle.plus.year");
        transaction.setRevocationDate(REVOKED_AT.toEpochMilli());
        StoreSubscriptionState state = map(Status.ACTIVE, transaction, renewal(AutoRenewStatus.ON));
        assertThat(state.status()).isEqualTo(SubscriptionStatus.CANCELED);
        assertThat(state.currentPeriodEnd()).isEqualTo(REVOKED_AT);
    }

    // A status newer than this library: not entitled, the polarity StripeService uses for the same case.
    @Test
    void anUnknownStatusIsNotEntitled() {
        StoreSubscriptionState state = map(null, transaction("huddle.plus.year"), null);
        assertThat(state.status()).isEqualTo(SubscriptionStatus.INCOMPLETE);
    }

    @Test
    void theRenewalInfosTokenIsUsedWhenTheTransactionHasNone() {
        JWSTransactionDecodedPayload transaction = transaction("huddle.plus.year");
        transaction.setAppAccountToken(null);
        JWSRenewalInfoDecodedPayload renewal = renewal(AutoRenewStatus.ON);
        UUID fromRenewal = UUID.randomUUID();
        renewal.setAppAccountToken(fromRenewal);
        assertThat(map(Status.ACTIVE, transaction, renewal).accountToken()).isEqualTo(fromRenewal);
    }

    @Test
    void anUnknownProductHasNoSku() {
        assertThat(map(Status.ACTIVE, transaction("huddle.team.year"), null).sku()).isNull();
    }

    @Test
    void junkIsRefusedAsAPurchase() {
        assertThatThrownBy(() -> provider.verifyPurchase("not.a.jws"))
                .isInstanceOf(StoreVerificationException.class);
        assertThatThrownBy(() -> provider.verifyPurchase(""))
                .isInstanceOf(StoreVerificationException.class);
    }

    @Test
    void junkIsRefusedAsANotification() {
        assertThatThrownBy(() -> provider.parseNotification("{\"signedPayload\":\"x.y.z\"}"))
                .isInstanceOf(StoreVerificationException.class);
        assertThatThrownBy(() -> provider.parseNotification("not json"))
                .isInstanceOf(StoreVerificationException.class);
        assertThatThrownBy(() -> provider.parseNotification("{}"))
                .isInstanceOf(StoreVerificationException.class);
    }

    @Test
    void anUnconfiguredEnvironmentIsNotConfiguredAndRefusesEverything() {
        AppStoreProvider unconfigured = new AppStoreProvider(new AppStoreProperties());
        assertThat(unconfigured.isConfigured()).isFalse();
        assertThat(unconfigured.skuForProductId("huddle.plus.year")).isEqualTo(Optional.empty());
        assertThatThrownBy(() -> unconfigured.verifyPurchase("a.b.c"))
                .isInstanceOf(StoreVerificationException.class);
    }

    // Online revocation checks are on (Apple's README). A check that could not reach Apple is retryable
    // -- the purchase must stay unfinished and be sent again, never be recorded as a forgery.
    @Test
    void anOnlineCheckThatCouldNotCompleteIsRetryableAndAForgeryIsNot() {
        assertThat(AppStoreProvider.isRetryable(java.util.List.of(
                com.apple.itunes.storekit.verification.VerificationStatus.INVALID_ENVIRONMENT,
                com.apple.itunes.storekit.verification.VerificationStatus.RETRYABLE_VERIFICATION_FAILURE))).isTrue();
        assertThat(AppStoreProvider.isRetryable(java.util.List.of(
                com.apple.itunes.storekit.verification.VerificationStatus.INVALID_ENVIRONMENT,
                com.apple.itunes.storekit.verification.VerificationStatus.VERIFICATION_FAILURE))).isFalse();
    }

    @Test
    void anEnvVarCarryingEscapedNewlinesBecomesAPem() {
        AppStoreProperties properties = new AppStoreProperties();
        properties.setPrivateKey("-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----");
        assertThat(properties.privateKeyPem()).isEqualTo("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    }
}
