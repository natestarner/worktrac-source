package com.worktrac.backend.billing;

import com.worktrac.backend.billing.store.StoreBillingProviders;
import com.worktrac.backend.billing.store.StorePurchaseReference;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.outbox.Outbox;
import com.worktrac.backend.outbox.OutboxHandler;
import com.worktrac.backend.outbox.OutboxHandlerProvider;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Carries out the overlap rule once SubscriptionService has decided it (docs/in-app-purchase-plan.md,
 * rule 5): cancel and refund the subscription we can cancel, and tell the owner. Two outbox rows per
 * overlap -- one external side effect each (OutboxHandler's rule) -- enqueued in the transaction that
 * found the overlap, so neither happens unless that write commits, and both survive a replica dying.
 *
 * <p>An overlap we cannot undo (two Apple IDs) cancels nothing: it is logged at ERROR, which is what
 * the production alerts watch, recorded, and the owner is told which one to cancel in Settings.
 */
@Component
public class BillingOverlapHandler implements OutboxHandlerProvider {

    static final String CANCEL_AND_REFUND = "billing.overlap-cancel-and-refund";
    static final String OWNER_NOTICE = "email.billing-overlap-notice";

    private static final Logger log = LoggerFactory.getLogger(BillingOverlapHandler.class);

    private final StripeService stripeService;
    private final StoreBillingProviders providers;
    private final BillingAuditService auditService;
    private final EmailService emailService;
    private final UserRepository userRepository;
    private final Outbox outbox;

    public BillingOverlapHandler(StripeService stripeService, StoreBillingProviders providers,
                                 BillingAuditService auditService, EmailService emailService,
                                 UserRepository userRepository, Outbox outbox) {
        this.stripeService = stripeService;
        this.providers = providers;
        this.auditService = auditService;
        this.emailService = emailService;
        this.userRepository = userRepository;
        this.outbox = outbox;
    }

    // Enqueue only. Several messages can report the same overlap before it is resolved (Stripe sends
    // three or four events per checkout), so nothing here may be once-only: the cancel and refund are
    // idempotent, and the owner's notice dedups itself at delivery, after this transaction committed.
    @EventListener
    public void onOverlap(BillingOverlapEvent event) {
        if (!event.uncancellable()) {
            outbox.enqueue(CANCEL_AND_REFUND, event);
        }
        outbox.enqueue(OWNER_NOTICE, event);
    }

    @Override
    public List<OutboxHandler<?>> outboxHandlers() {
        return List.of(
                new OutboxHandler<>(CANCEL_AND_REFUND, BillingOverlapEvent.class, this::cancelAndRefund,
                        (event, reason) -> {
                            auditService.record(event.accountId(), BillingEventType.OVERLAP_REFUNDED,
                                    "FAILED to cancel and refund " + event.loser() + " " + event.loserSubscriptionId()
                                            + " -- do it by hand; the household is billed by " + event.keeper()
                                            + ". Reason: " + reason);
                            log.error("Could not cancel and refund overlapping {} subscription {} for account {}: {}",
                                    event.loser(), event.loserSubscriptionId(), event.accountId(), reason);
                        }),
                new OutboxHandler<>(OWNER_NOTICE, BillingOverlapEvent.class, this::notifyOwner,
                        (event, reason) -> log.error("Gave up telling account {} about a billing overlap: {}",
                                event.accountId(), reason)));
    }

    private void cancelAndRefund(BillingOverlapEvent event) throws Exception {
        String done;
        if (event.loser() == BillingSource.STRIPE) {
            done = stripeService.cancelAndRefundLatestPayment(event.loserSubscriptionId());
        } else {
            var provider = providers.forSource(event.loser()).orElseThrow(() -> new IllegalStateException(
                    "No provider for " + event.loser()));
            done = provider.cancelAndRefund(new StorePurchaseReference(event.loser(), event.loserSubscriptionId(),
                    event.loserEnvironment(), null, null));
        }
        auditService.record(event.accountId(), BillingEventType.OVERLAP_REFUNDED,
                done + " because " + event.keeper() + " is billing this household");
    }

    private void notifyOwner(BillingOverlapEvent event) {
        // ONCE per overlap, however many messages reported it: V57's unique index on the event-id
        // column is the dedup point, the same mechanism Stripe webhooks use. Claimed at DELIVERY, so
        // a write that rolled back never claims it, and released if the send fails so the retry sends.
        String onceKey = "overlap-notice:" + sha256(event.loser() + ":" + event.loserSubscriptionId());
        BillingEventType type = event.uncancellable()
                ? BillingEventType.OVERLAP_UNCANCELLABLE
                : BillingEventType.OVERLAP_REFUNDED;
        String detail = event.uncancellable()
                ? "Kept " + event.keeper() + " " + event.keeperSubscriptionId() + "; also paying: " + event.loser()
                        + " " + event.loserSubscriptionId() + ". Neither can be cancelled by us; owner asked to"
                        + " cancel one in Settings."
                : "Owner told that " + event.loser() + " " + event.loserSubscriptionId()
                        + " was cancelled and refunded in favour of " + event.keeper();
        if (!auditService.recordIfFirstSeen(event.accountId(), onceKey, type, detail)) {
            return;
        }
        if (event.uncancellable()) {
            log.error("Billing overlap we cannot undo for account {}: {} {} and {} {} are both paying",
                    event.accountId(), event.keeper(), event.keeperSubscriptionId(),
                    event.loser(), event.loserSubscriptionId());
        }

        String ownerEmail = userRepository.findOwners(event.accountId()).stream()
                .findFirst()
                .map(User::getEmail)
                .orElse(null);
        if (ownerEmail == null) {
            log.warn("No owner to tell about a billing overlap on account {}", event.accountId());
            return;
        }
        try {
            if (event.uncancellable()) {
                emailService.sendBillingNotice(ownerEmail, "You have two Huddle subscriptions",
                        "Two Apple IDs are each paying for a Huddle subscription for your household. You only"
                                + " need one. On the iPhone or iPad signed in to the Apple ID you want to stop"
                                + " paying with, open Settings, tap your name, then Subscriptions, choose Huddle"
                                + " and cancel it. Your plan stays exactly as it is.");
            } else {
                emailService.sendBillingNotice(ownerEmail, "We refunded a duplicate Huddle subscription",
                        "Your household ended up with two Huddle subscriptions, one through "
                                + displayName(event.keeper()) + " and one through " + displayName(event.loser())
                                + ". You only need one, so we cancelled the " + displayName(event.loser())
                                + " one and refunded its latest payment in full. Your plan stays exactly as it"
                                + " is, billed through " + displayName(event.keeper()) + ".");
            }
        } catch (RuntimeException e) {
            auditService.forgetFirstSeen(onceKey);
            throw e;
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // The store's own name, the way a person would say it. Exhaustive with no default, so a new
    // source refuses to compile until somebody writes its name.
    static String displayName(BillingSource source) {
        return switch (source) {
            case STRIPE -> "huddle.fitness";
            case APP_STORE -> "the App Store";
            case GOOGLE_PLAY -> "Google Play";
        };
    }
}
