package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingSource;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Re-applies every subscription a store message failed to reach us about. Apple's documented
 * recovery from an outage ("Responding to App Store Server Notifications": call Get Notification
 * History), and the only recovery for its SANDBOX, which sends each notification once and never
 * retries -- so App Review's or a TestFlight tester's purchase notice, landing on a lower backend that
 * is still cold-starting, would otherwise be lost for good.
 *
 * <p>Belt and braces beside the reconciliation watchdog, which only catches a paid period that has
 * already LAPSED. This catches the rest -- a missed cancellation, refund or plan change -- within the
 * hour. Nothing here decides anything: each subscription goes through the same
 * {@link StoreBillingService#apply} as a live notification, which re-fetches the store's current
 * state, so applying one twice (or one that was in fact delivered) changes nothing.
 */
@Component
public class StoreNotificationRecovery {

    private static final Logger log = LoggerFactory.getLogger(StoreNotificationRecovery.class);

    /**
     * How far back each run looks. Longer than the run interval so a run that failed (or a replica
     * that died holding the lock) is covered by the next one; an overlap only re-applies what was
     * already applied.
     */
    static final Duration LOOK_BACK = Duration.ofHours(26);

    private final StoreBillingProviders providers;
    private final StoreBillingService storeBillingService;
    private final Clock clock;

    public StoreNotificationRecovery(StoreBillingProviders providers, StoreBillingService storeBillingService,
                                     Clock clock) {
        this.providers = providers;
        this.storeBillingService = storeBillingService;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT10M")
    @SchedulerLock(name = "storeNotificationRecovery", lockAtLeastFor = "PT55M", lockAtMostFor = "PT59M")
    public void recover() {
        for (BillingSource source : BillingSource.values()) {
            if (source.isStore()) {
                providers.forSource(source)
                        .filter(StoreBillingProvider::isConfigured)
                        .ifPresent(this::recover);
            }
        }
    }

    /** One store's sweep. Package-private for the test. Answers how many subscriptions it re-applied. */
    int recover(StoreBillingProvider provider) {
        List<StorePurchaseReference> undelivered;
        try {
            undelivered = provider.undeliveredSince(clock.instant().minus(LOOK_BACK));
        } catch (StoreBillingException e) {
            // The next hourly run looks back far enough to cover this one.
            log.warn("Could not read {}'s undelivered notifications: {}", provider.source(), e.getMessage());
            return 0;
        }
        // One re-fetch per subscription however many of its messages failed: they all ask the same
        // question, and the store's current answer covers every one of them.
        Map<String, StorePurchaseReference> bySubscription = new LinkedHashMap<>();
        for (StorePurchaseReference reference : undelivered) {
            bySubscription.putIfAbsent(reference.environment() + ":" + reference.subscriptionId(), reference);
        }
        int applied = 0;
        for (StorePurchaseReference reference : bySubscription.values()) {
            try {
                storeBillingService.apply(provider, reference, "recovery");
                applied++;
            } catch (StoreBillingException e) {
                log.warn("Could not re-apply {} subscription {}: {}", provider.source(), reference.subscriptionId(),
                        e.getMessage());
            } catch (RuntimeException e) {
                // One household's database failure must not stop the sweep for the rest.
                log.error("Re-applying {} subscription {} failed", provider.source(), reference.subscriptionId(), e);
            }
        }
        if (applied > 0) {
            log.info("Re-applied {} {} subscription(s) whose notifications never reached us", applied,
                    provider.source());
        }
        return applied;
    }
}
