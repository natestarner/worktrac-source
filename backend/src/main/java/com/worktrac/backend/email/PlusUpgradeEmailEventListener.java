package com.worktrac.backend.email;

import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.PlusUpgradedEvent;
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
import java.util.Optional;

// Sends the welcome-to-Plus email after a household's FIRST-ever upgrade, through the outbox
// (outbox.Outbox) -- the row commits in the same transaction as the upgrade and its "welcome
// claimed" marker, is sent after commit, and survives the replica that wrote it. Same shape as
// RegistrationEmailEventListener, and a separate component for the same reason
// ContactEmailEventListener is: the natural home for this outcome is billing_events
// (BillingAuditService), not the registration audit trail, since it is keyed by account rather
// than by email and already holds every other billing lifecycle moment.
//
// PlusUpgradedEvent is only ever published from SubscriptionService.applyStripeState, which is
// @Transactional, so the outbox row joins that transaction.
@Component
public class PlusUpgradeEmailEventListener implements OutboxHandlerProvider {

    static final String PLUS_WELCOME = "email.plus-welcome";

    private static final Logger log = LoggerFactory.getLogger(PlusUpgradeEmailEventListener.class);

    private final EmailService emailService;
    private final UserRepository userRepository;
    private final BillingAuditService auditService;
    private final Outbox outbox;

    public PlusUpgradeEmailEventListener(EmailService emailService, UserRepository userRepository,
                                         BillingAuditService auditService, Outbox outbox) {
        this.emailService = emailService;
        this.userRepository = userRepository;
        this.auditService = auditService;
        this.outbox = outbox;
    }

    @EventListener
    public void onPlusUpgraded(PlusUpgradedEvent event) {
        outbox.enqueue(PLUS_WELCOME, event);
    }

    @Override
    public List<OutboxHandler<?>> outboxHandlers() {
        return List.of(new OutboxHandler<>(PLUS_WELCOME, PlusUpgradedEvent.class,
                this::deliver,
                (event, reason) -> {
                    log.error("Gave up sending welcome-to-Plus email for account {}: {}", event.accountId(), reason);
                    recordSafely(event.accountId(), BillingEventType.PLUS_WELCOME_EMAIL_FAILED, reason);
                }));
    }

    private void deliver(PlusUpgradedEvent event) {
        Long accountId = event.accountId();

        // The OWNER specifically, same reasoning as the Stripe Customer's address
        // (BillingController#createCheckoutSession): the owner is the billing relationship, and a
        // member's inbox is neither the right destination nor stable.
        Optional<String> ownerEmail = userRepository.findOwners(accountId).stream()
                .findFirst()
                .map(User::getEmail);

        if (ownerEmail.isEmpty()) {
            // Not reachable in practice -- an account that just went through applyStripeState has an
            // owner by construction -- but recording it rather than silently doing nothing is the
            // whole point of this audit trail.
            log.warn("No owner login found for account {}; welcome email not sent", accountId);
            recordSafely(accountId, BillingEventType.PLUS_WELCOME_EMAIL_FAILED, "No owner login found");
            return;
        }

        // A send failure propagates, so the outbox retries it; the give-up above records FAILED.
        String messageId = emailService.sendPlusWelcome(ownerEmail.get(), event.plan());
        recordSafely(accountId, BillingEventType.PLUS_WELCOME_EMAIL_SENT, messageId);
    }

    // Isolated from the send itself, same as RegistrationEmailEventListener#recordSafely: a DB
    // hiccup persisting the audit row must never be misreported as the email having failed to send.
    private void recordSafely(Long accountId, BillingEventType type, String detail) {
        try {
            auditService.record(accountId, type, detail);
        } catch (Exception e) {
            log.error("Failed to persist billing-audit event {} for account {} (detail={})",
                    type, accountId, detail, e);
        }
    }

}
