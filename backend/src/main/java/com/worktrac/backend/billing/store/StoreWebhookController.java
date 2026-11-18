package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.BillingSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * The app stores' server-to-server notifications (Apple: App Store Server Notifications V2, pointed at
 * {@code /api/webhooks/store/app-store}). A sibling of StripeWebhookController, and exempt from
 * {@code @RequiresPermission} for the same reason: permitAll (SecurityConfig), no login possible,
 * authenticated instead by the store's own signature, which the provider verifies before anything is
 * read.
 *
 * <p>401 for anything that does not verify (or a store not configured here); 503 when we could not
 * reach the store to re-fetch, so it delivers again; 200 for everything we understood, whatever we did
 * with it. A message only says WHICH subscription changed -- StoreBillingService re-fetches its state.
 */
@RestController
public class StoreWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StoreWebhookController.class);

    private final StoreBillingProviders providers;
    private final StoreBillingService storeBillingService;
    private final BillingAuditService auditService;

    public StoreWebhookController(StoreBillingProviders providers, StoreBillingService storeBillingService,
                                  BillingAuditService auditService) {
        this.providers = providers;
        this.storeBillingService = storeBillingService;
        this.auditService = auditService;
    }

    @PostMapping("/api/webhooks/store/{store}")
    public ResponseEntity<Void> notification(@PathVariable String store, @RequestBody String body) {
        StoreBillingProvider provider = BillingSource.storeFromPathSegment(store)
                .flatMap(providers::forSource)
                .filter(StoreBillingProvider::isConfigured)
                .orElse(null);
        if (provider == null) {
            log.warn("Rejected store notification for '{}': not configured here", store);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        Optional<StorePurchaseReference> reference;
        try {
            reference = provider.parseNotification(body);
        } catch (StoreVerificationException e) {
            auditService.record(null, BillingEventType.STORE_REJECTED,
                    "notification: " + provider.source() + " did not verify: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        } catch (StoreBillingException e) {
            // The certificate check could not reach Apple just now: not a forgery, so ask for a retry.
            log.warn("Could not verify {} notification yet: {}", provider.source(), e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        if (reference.isEmpty()) {
            return ResponseEntity.ok().build();
        }
        try {
            storeBillingService.apply(provider, reference.get(), "notification");
        } catch (StoreBillingException e) {
            log.error("Could not apply {} notification for {}", provider.source(), reference.get().subscriptionId(), e);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        return ResponseEntity.ok().build();
    }
}
