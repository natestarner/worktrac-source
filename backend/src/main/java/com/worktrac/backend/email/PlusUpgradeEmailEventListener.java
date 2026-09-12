package com.worktrac.backend.email;

import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.PlusUpgradedEvent;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Optional;

// Sends the welcome-to-Plus email after a household's FIRST-ever upgrade, off the request thread
// and only once the triggering transaction has committed -- same shape as
// RegistrationEmailEventListener, and a separate component for the same reason
// ContactEmailEventListener is: the natural home for this outcome is billing_events
// (BillingAuditService), not the registration audit trail, since it is keyed by account rather
// than by email and already holds every other billing lifecycle moment.
//
// AFTER_COMMIT is safe here unconditionally, unlike most callers of this annotation: PlusUpgradedEvent
// is only ever published from SubscriptionService.applyStripeState, which is @Transactional, as are
// all three of its callers (the Stripe webhook, the billing controller's checkout reconcile, and the
// reconciliation watchdog) -- see AccountPlanChangedListener's javadoc for why that check matters
// rather than being assumed.
@Component
public class PlusUpgradeEmailEventListener {

    private static final Logger log = LoggerFactory.getLogger(PlusUpgradeEmailEventListener.class);

    private final EmailService emailService;
    private final UserRepository userRepository;
    private final BillingAuditService auditService;

    public PlusUpgradeEmailEventListener(EmailService emailService, UserRepository userRepository,
                                         BillingAuditService auditService) {
        this.emailService = emailService;
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPlusUpgraded(PlusUpgradedEvent event) {
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
            log.warn("No owner login found for account {}; welcome-to-Plus email not sent", accountId);
            recordSafely(accountId, BillingEventType.PRO_WELCOME_EMAIL_FAILED, "No owner login found");
            return;
        }

        String email = ownerEmail.get();
        String messageId;
        try {
            messageId = emailService.sendPlusWelcome(email);
        } catch (Exception e) {
            log.error("Failed to send welcome-to-Plus email for account {}", accountId, e);
            recordSafely(accountId, BillingEventType.PRO_WELCOME_EMAIL_FAILED, failureReason(e));
            return;
        }
        recordSafely(accountId, BillingEventType.PRO_WELCOME_EMAIL_SENT, messageId);
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

    private String failureReason(Exception e) {
        String message = e.getMessage();
        if (message != null && !message.isBlank()) {
            return e.getClass().getSimpleName() + ": " + message;
        }
        return e.getClass().getSimpleName();
    }
}
