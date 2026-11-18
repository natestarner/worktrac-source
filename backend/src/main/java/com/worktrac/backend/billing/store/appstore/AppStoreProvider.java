package com.worktrac.backend.billing.store.appstore;

import com.apple.itunes.storekit.client.APIException;
import com.apple.itunes.storekit.client.AppStoreServerAPIClient;
import com.apple.itunes.storekit.model.AutoRenewStatus;
import com.apple.itunes.storekit.model.Environment;
import com.apple.itunes.storekit.model.JWSRenewalInfoDecodedPayload;
import com.apple.itunes.storekit.model.JWSTransactionDecodedPayload;
import com.apple.itunes.storekit.model.LastTransactionsItem;
import com.apple.itunes.storekit.model.NotificationHistoryRequest;
import com.apple.itunes.storekit.model.NotificationHistoryResponse;
import com.apple.itunes.storekit.model.NotificationHistoryResponseItem;
import com.apple.itunes.storekit.model.NotificationTypeV2;
import com.apple.itunes.storekit.model.ResponseBodyV2DecodedPayload;
import com.apple.itunes.storekit.model.Status;
import com.apple.itunes.storekit.model.StatusResponse;
import com.apple.itunes.storekit.model.SubscriptionGroupIdentifierItem;
import com.apple.itunes.storekit.verification.SignedDataVerifier;
import com.apple.itunes.storekit.verification.VerificationException;
import com.apple.itunes.storekit.verification.VerificationStatus;
import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.PlanSku;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.billing.store.StoreBillingException;
import com.worktrac.backend.billing.store.StoreBillingProvider;
import com.worktrac.backend.billing.store.StoreEnvironment;
import com.worktrac.backend.billing.store.StorePurchaseReference;
import com.worktrac.backend.billing.store.StoreSubscriptionState;
import com.worktrac.backend.billing.store.StoreVerificationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Apple's App Store, through Apple's own App Store Server Library.
 *
 * <p>⚠️ THE ONLY class that imports {@code com.apple.itunes.storekit.*}, the way StripeService is the
 * only one importing Stripe. Everything above {@link StoreBillingProvider} is tested with a fake; the
 * mapping from Apple's states to ours ({@link #toState}) is tested directly with Apple's own payload
 * types.
 *
 * <p>BOTH ENVIRONMENTS, ALWAYS. App Review and TestFlight purchases are sandbox purchases even against
 * the production app and backend, so a production backend that refused them would show the reviewer a
 * purchase that unlocked nothing. Every signed payload names its environment; it is verified with that
 * environment's verifier, and the row remembers which one so later reads ask the right server.
 * Xcode's local StoreKit testing is never accepted: it is signed by a certificate on the developer's Mac.
 */
@Service
public class AppStoreProvider implements StoreBillingProvider {

    private static final Logger log = LoggerFactory.getLogger(AppStoreProvider.class);

    private static final String ROOT_CERTIFICATE = "/appstore/AppleRootCA-G3.cer";

    private final AppStoreProperties properties;
    private final byte[] rootCertificate;
    private final Map<StoreEnvironment, SignedDataVerifier> verifiers = new EnumMap<>(StoreEnvironment.class);
    private final Map<StoreEnvironment, AppStoreServerAPIClient> clients = new EnumMap<>(StoreEnvironment.class);

    public AppStoreProvider(AppStoreProperties properties) {
        this.properties = properties;
        try (InputStream in = AppStoreProvider.class.getResourceAsStream(ROOT_CERTIFICATE)) {
            if (in == null) {
                throw new IllegalStateException("Missing " + ROOT_CERTIFICATE);
            }
            this.rootCertificate = in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public BillingSource source() {
        return BillingSource.APP_STORE;
    }

    @Override
    public boolean isConfigured() {
        return properties.isConfigured();
    }

    // `huddle.` + PLUS_YEAR -> huddle.plus.year; PRO_STUDIO_MONTH -> huddle.pro.studio.month. Derived
    // from the enum so there is no per-product config to drift, the same reason PlanSku's name is the
    // Stripe config key.
    @Override
    public String productIdFor(PlanSku sku) {
        return properties.getProductPrefix() + sku.name().toLowerCase(Locale.ROOT).replace('_', '.');
    }

    @Override
    public Optional<PlanSku> skuForProductId(String productId) {
        if (productId == null || !isConfigured()) {
            return Optional.empty();
        }
        return Arrays.stream(PlanSku.values()).filter(sku -> productIdFor(sku).equals(productId)).findFirst();
    }

    /** The app sends StoreKit 2's {@code Transaction.jwsRepresentation}. */
    @Override
    public StorePurchaseReference verifyPurchase(String signedTransaction)
            throws StoreVerificationException, StoreBillingException {
        Verified<JWSTransactionDecodedPayload> verified = verifyInEitherEnvironment(
                signedTransaction, SignedDataVerifier::verifyAndDecodeTransaction);
        JWSTransactionDecodedPayload transaction = verified.payload();
        if (transaction.getOriginalTransactionId() == null) {
            throw new StoreVerificationException("Transaction carries no original transaction id");
        }
        return new StorePurchaseReference(BillingSource.APP_STORE, transaction.getOriginalTransactionId(),
                verified.environment(), transaction.getAppAccountToken(), transaction.getProductId());
    }

    /** Apple's App Store Server Notifications V2: a JSON body {@code {"signedPayload": "..."}}. */
    @Override
    public Optional<StorePurchaseReference> parseNotification(String body)
            throws StoreVerificationException, StoreBillingException {
        return parseSignedNotification(signedPayloadOf(body));
    }

    private Optional<StorePurchaseReference> parseSignedNotification(String signedPayload)
            throws StoreVerificationException, StoreBillingException {
        Verified<ResponseBodyV2DecodedPayload> verified = verifyInEitherEnvironment(
                signedPayload, SignedDataVerifier::verifyAndDecodeNotification);
        ResponseBodyV2DecodedPayload notification = verified.payload();
        if (notification.getNotificationType() == NotificationTypeV2.TEST || notification.getData() == null
                || notification.getData().getSignedTransactionInfo() == null) {
            // TEST (sent from App Store Connect or requestTestNotification), or a notification about the
            // app rather than a subscription. Genuine, and nothing to apply.
            return Optional.empty();
        }
        JWSTransactionDecodedPayload transaction;
        try {
            transaction = verifier(verified.environment())
                    .verifyAndDecodeTransaction(notification.getData().getSignedTransactionInfo());
        } catch (VerificationException e) {
            if (e.getStatus() == VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
                throw new StoreBillingException("Apple's certificate check could not be completed just now", e);
            }
            throw new StoreVerificationException("Notification's transaction did not verify: " + e.getStatus(), e);
        }
        return Optional.of(new StorePurchaseReference(BillingSource.APP_STORE,
                transaction.getOriginalTransactionId(), verified.environment(), transaction.getAppAccountToken(),
                transaction.getProductId()));
    }

    /** Apple's Get All Subscription Statuses, narrowed to this subscription. */
    @Override
    public StoreSubscriptionState fetchState(StorePurchaseReference reference) throws StoreBillingException {
        StoreEnvironment environment = reference.environment() == null
                ? StoreEnvironment.PRODUCTION
                : reference.environment();
        StatusResponse response;
        try {
            response = client(environment).getAllSubscriptionStatuses(reference.subscriptionId(), null);
        } catch (APIException e) {
            throw new StoreBillingException("App Store Server API answered " + e.getHttpStatusCode() + " "
                    + e.getApiError() + " for " + reference.subscriptionId(), e);
        } catch (IOException e) {
            throw new StoreBillingException("Could not reach the App Store Server API", e);
        }

        LastTransactionsItem latest = findLatest(response, reference.subscriptionId()).orElseThrow(
                () -> new StoreBillingException("Apple returned no status for " + reference.subscriptionId()));
        try {
            SignedDataVerifier verifier = verifier(environment);
            JWSTransactionDecodedPayload transaction = verifier.verifyAndDecodeTransaction(latest.getSignedTransactionInfo());
            JWSRenewalInfoDecodedPayload renewal = latest.getSignedRenewalInfo() == null
                    ? null
                    : verifier.verifyAndDecodeRenewalInfo(latest.getSignedRenewalInfo());
            return toState(latest.getStatus(), transaction, renewal, environment, this::skuForProductId);
        } catch (VerificationException e) {
            // Apple's own API answered with data that does not verify (or the online certificate check
            // could not complete): not something a retry fixes
            // quickly, but not the caller's fault either. Transient from their side, loudly logged.
            log.error("App Store status for {} did not verify: {}", reference.subscriptionId(), e.getStatus());
            throw new StoreBillingException("App Store status did not verify: " + e.getStatus(), e);
        }
    }

    /**
     * Apple's states onto ours (docs/in-app-purchase-plan.md, "How Apple's states map"). Reuses the
     * Stripe semantics {@code isEntitled} already implements, so no new status exists:
     *
     * <pre>
     * Active, auto-renew on      ACTIVE    expires date      cancelAtPeriodEnd false
     * Active, auto-renew off     ACTIVE    expires date      cancelAtPeriodEnd true
     * Billing grace period       PAST_DUE  grace period end  false   (entitled, like Stripe dunning)
     * Billing retry after grace  CANCELED  expires (past)    false   (not entitled)
     * Expired                    CANCELED  expires date      false
     * Revoked (refunded)         CANCELED  revocation date   false   (not entitled, immediately)
     * </pre>
     */
    static StoreSubscriptionState toState(Status status, JWSTransactionDecodedPayload transaction,
                                          JWSRenewalInfoDecodedPayload renewal, StoreEnvironment environment,
                                          java.util.function.Function<String, Optional<PlanSku>> skuLookup) {
        Instant expires = instant(transaction.getExpiresDate());
        boolean autoRenewOff = renewal != null && renewal.getAutoRenewStatus() == AutoRenewStatus.OFF;

        SubscriptionStatus mapped;
        Instant periodEnd;
        boolean cancelAtPeriodEnd = false;
        Status effective = transaction.getRevocationDate() != null ? Status.REVOKED : status;
        if (effective == null) {
            // A status Apple added after this library: unknown means NOT entitled -- the same polarity
            // StripeService.mapStatus uses, because guessing generously gives a paid plan away.
            mapped = SubscriptionStatus.INCOMPLETE;
            periodEnd = expires;
        } else {
            switch (effective) {
                case ACTIVE -> {
                    mapped = SubscriptionStatus.ACTIVE;
                    periodEnd = expires;
                    cancelAtPeriodEnd = autoRenewOff;
                }
                case BILLING_GRACE_PERIOD -> {
                    mapped = SubscriptionStatus.PAST_DUE;
                    Instant graceEnd = renewal == null ? null : instant(renewal.getGracePeriodExpiresDate());
                    periodEnd = graceEnd != null ? graceEnd : expires;
                }
                case REVOKED -> {
                    mapped = SubscriptionStatus.CANCELED;
                    Instant revoked = instant(transaction.getRevocationDate());
                    periodEnd = revoked != null ? revoked : expires;
                }
                default -> { // EXPIRED, BILLING_RETRY
                    mapped = SubscriptionStatus.CANCELED;
                    periodEnd = expires;
                }
            }
        }

        java.util.UUID token = transaction.getAppAccountToken() != null
                ? transaction.getAppAccountToken()
                : renewal == null ? null : renewal.getAppAccountToken();
        String productId = transaction.getProductId();
        return new StoreSubscriptionState(BillingSource.APP_STORE, transaction.getOriginalTransactionId(), productId,
                skuLookup.apply(productId).orElse(null), mapped, periodEnd, cancelAtPeriodEnd, environment, token);
    }

    /**
     * Notifications Apple could not deliver, from Get Notification History with {@code onlyFailures},
     * in both environments. Apple names this as the way to recover after an outage; it matters most
     * for the sandbox, where Apple sends each notification once and never retries -- so a lower backend
     * cold-starting through one would otherwise miss it for good.
     */
    @Override
    public java.util.List<StorePurchaseReference> undeliveredSince(Instant since) throws StoreBillingException {
        java.util.List<StorePurchaseReference> references = new java.util.ArrayList<>();
        for (StoreEnvironment environment : StoreEnvironment.values()) {
            String paginationToken = null;
            do {
                NotificationHistoryResponse page;
                try {
                    page = client(environment).getNotificationHistory(paginationToken, new NotificationHistoryRequest()
                            .startDate(since.toEpochMilli())
                            .endDate(Instant.now().toEpochMilli())
                            .onlyFailures(true));
                } catch (APIException e) {
                    throw new StoreBillingException("Get Notification History answered " + e.getHttpStatusCode()
                            + " " + e.getApiError() + " (" + environment + ")", e);
                } catch (IOException e) {
                    throw new StoreBillingException("Could not reach the App Store Server API", e);
                }
                if (page.getNotificationHistory() != null) {
                    for (NotificationHistoryResponseItem item : page.getNotificationHistory()) {
                        try {
                            parseSignedNotification(item.getSignedPayload()).ifPresent(references::add);
                        } catch (StoreVerificationException e) {
                            log.warn("Skipping an undeliverable {} notification that does not verify: {}",
                                    environment, e.getMessage());
                        }
                    }
                }
                paginationToken = Boolean.TRUE.equals(page.getHasMore()) ? page.getPaginationToken() : null;
            } while (paginationToken != null);
        }
        return references;
    }

    /** Apple's Set App Account Token, on the subscription's original transaction. */
    @Override
    public void stampAccountToken(StorePurchaseReference reference, java.util.UUID accountToken)
            throws StoreBillingException {
        StoreEnvironment environment = reference.environment() == null
                ? StoreEnvironment.PRODUCTION
                : reference.environment();
        try {
            client(environment).setAppAccountToken(reference.subscriptionId(),
                    new com.apple.itunes.storekit.model.UpdateAppAccountTokenRequest(accountToken));
        } catch (APIException e) {
            throw new StoreBillingException("Set App Account Token answered " + e.getHttpStatusCode() + " "
                    + e.getApiError() + " for " + reference.subscriptionId(), e);
        } catch (IOException e) {
            throw new StoreBillingException("Could not reach the App Store Server API", e);
        }
    }

    @Override
    public String cancelAndRefund(StorePurchaseReference reference) {
        // Never reached: BillingSource.APP_STORE.weCanCancel() is false, so the overlap rule never picks
        // an App Store subscription to cancel. Apple offers no server-side cancellation at all.
        throw new UnsupportedOperationException("Apple subscriptions can only be cancelled by the subscriber");
    }

    @Override
    public void acknowledge(StorePurchaseReference reference) {
        // Nothing: Apple needs no server acknowledgement. The app finishes the transaction on the device.
    }

    // ---- plumbing ----

    private record Verified<T>(T payload, StoreEnvironment environment) {
    }

    @FunctionalInterface
    private interface Decode<T> {
        T apply(SignedDataVerifier verifier, String signed) throws VerificationException;
    }

    // Production first (the common case), then sandbox. The library refuses data whose environment
    // differs from the verifier's, so exactly one can succeed; a bad signature fails both.
    //
    // A RETRYABLE failure (the online certificate check could not reach Apple) is TRANSIENT, never a
    // forgery: it becomes a StoreBillingException, so the app keeps the transaction unfinished and
    // Apple redelivers its notification, instead of the proof being recorded as fake and finished.
    private <T> Verified<T> verifyInEitherEnvironment(String signed, Decode<T> decode)
            throws StoreVerificationException, StoreBillingException {
        requireConfigured();
        if (signed == null || signed.isBlank()) {
            throw new StoreVerificationException("Nothing to verify");
        }
        java.util.List<VerificationException> failures = new java.util.ArrayList<>();
        for (StoreEnvironment environment : StoreEnvironment.values()) {
            try {
                return new Verified<>(decode.apply(verifier(environment), signed), environment);
            } catch (VerificationException e) {
                failures.add(e);
            }
        }
        if (isRetryable(failures.stream().map(VerificationException::getStatus).toList())) {
            throw new StoreBillingException("Apple's certificate check could not be completed just now",
                    failures.getLast());
        }
        VerificationException last = failures.getLast();
        throw new StoreVerificationException("Did not verify as an App Store payload: " + last.getStatus(), last);
    }

    /**
     * Whether a payload that verified in neither environment may verify on a retry: some environment
     * failed only because the online check could not complete. Package-private for the test.
     */
    static boolean isRetryable(java.util.List<VerificationStatus> statuses) {
        return statuses.contains(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE);
    }

    private static Optional<LastTransactionsItem> findLatest(StatusResponse response, String originalTransactionId) {
        if (response == null || response.getData() == null) {
            return Optional.empty();
        }
        return response.getData().stream()
                .map(SubscriptionGroupIdentifierItem::getLastTransactions)
                .filter(java.util.Objects::nonNull)
                .flatMap(java.util.List::stream)
                .filter(item -> originalTransactionId.equals(item.getOriginalTransactionId()))
                .findFirst();
    }

    private static String signedPayloadOf(String body) throws StoreVerificationException {
        try {
            var node = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
            var signed = node == null ? null : node.get("signedPayload");
            if (signed == null || !signed.isTextual()) {
                throw new StoreVerificationException("No signedPayload in the notification body");
            }
            return signed.asText();
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new StoreVerificationException("Notification body is not JSON", e);
        }
    }

    private synchronized SignedDataVerifier verifier(StoreEnvironment environment) {
        return verifiers.computeIfAbsent(environment, env -> new SignedDataVerifier(
                Set.of(new ByteArrayInputStream(rootCertificate)), properties.getBundleId(),
                // Apple requires the app's Apple ID only to verify PRODUCTION data.
                env == StoreEnvironment.PRODUCTION ? properties.getAppAppleId() : null,
                appleEnvironment(env),
                // Online certificate-revocation checks ON, as Apple's own README configures it. A check
                // that cannot reach Apple is RETRYABLE_VERIFICATION_FAILURE, which verifyInEitherEnvironment
                // treats as transient (503, retried) -- never as a forged purchase.
                true));
    }

    private synchronized AppStoreServerAPIClient client(StoreEnvironment environment) {
        requireConfiguredUnchecked();
        return clients.computeIfAbsent(environment, env -> new AppStoreServerAPIClient(
                properties.privateKeyPem(), properties.getKeyId(), properties.getIssuerId(),
                properties.getBundleId(), appleEnvironment(env)));
    }

    private static Environment appleEnvironment(StoreEnvironment environment) {
        return environment == StoreEnvironment.PRODUCTION ? Environment.PRODUCTION : Environment.SANDBOX;
    }

    private void requireConfigured() throws StoreVerificationException {
        if (!isConfigured()) {
            throw new StoreVerificationException("App Store billing is not configured in this environment");
        }
    }

    private void requireConfiguredUnchecked() {
        if (!isConfigured()) {
            throw new IllegalStateException("App Store billing is not configured in this environment");
        }
    }

    private static Instant instant(Long epochMillis) {
        return epochMillis == null ? null : Instant.ofEpochMilli(epochMillis);
    }
}
