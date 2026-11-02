package com.worktrac.backend.email;

import com.worktrac.backend.membership.MembershipAcceptedEvent;
import com.worktrac.backend.membership.MembershipInviteIssuedEvent;
import com.worktrac.backend.membership.MembershipRevokedEvent;
import com.worktrac.backend.outbox.Outbox;
import com.worktrac.backend.outbox.OutboxHandler;
import com.worktrac.backend.outbox.OutboxHandlerProvider;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.PasswordResetCodeIssuedEvent;
import com.worktrac.backend.user.PasswordResetConfirmedEvent;
import com.worktrac.backend.user.RegistrationConfirmedEvent;
import com.worktrac.backend.user.VerificationCodeIssuedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.function.Function;

// Registration, password-reset and member-login emails. Each event becomes an outbox row INSIDE the
// transaction that published it (see outbox.Outbox), so the email commits or rolls back with the
// change that caused it, survives the replica that wrote it, and is sent straight after commit, off
// the request thread. A slow or failing Azure Communication Services call still cannot roll back
// the account creation or password change it follows -- the send happens after commit, as before.
//
// These used to be AFTER_COMMIT + @Async listeners that sent directly. That held the only copy of
// the email in an in-process queue, so a replica scaling in or redeploying at the wrong moment lost
// it with no trace. The handlers below are the same send-and-record bodies, now run by
// outbox.OutboxDispatcher -- which also retries a failed send with backoff before giving up.
//
// Every outcome is still recorded via RegistrationAuditService, never just logged:
//   * SENT is recorded by the delivery, in its own try/catch separate from the send (recordSafely):
//     if the send succeeds and only the audit write throws, that must never read as the email having
//     failed -- it genuinely went out.
//   * FAILED is recorded once, when the outbox gives up after its last attempt, with the real reason.
//     A failed attempt that a retry then recovers is a log line, not an audit event or an alert.
@Component
public class RegistrationEmailEventListener implements OutboxHandlerProvider {

    private static final Logger log = LoggerFactory.getLogger(RegistrationEmailEventListener.class);

    static final String VERIFICATION_CODE = "email.verification-code";
    static final String REGISTRATION_SUCCESS = "email.registration-success";
    static final String PASSWORD_RESET_CODE = "email.password-reset-code";
    static final String PASSWORD_RESET_SUCCESS = "email.password-reset-success";
    static final String MEMBER_INVITE = "email.member-invite";
    static final String MEMBER_JOINED = "email.member-joined";
    static final String MEMBER_ACCEPTED_OWNER = "email.member-accepted-owner";
    static final String MEMBER_REVOKED = "email.member-revoked";

    private final EmailService emailService;
    private final RegistrationAuditService auditService;
    private final Outbox outbox;

    public RegistrationEmailEventListener(EmailService emailService, RegistrationAuditService auditService,
                                          Outbox outbox) {
        this.emailService = emailService;
        this.auditService = auditService;
        this.outbox = outbox;
    }

    @EventListener
    public void onVerificationCodeIssued(VerificationCodeIssuedEvent event) {
        outbox.enqueue(VERIFICATION_CODE, event);
    }

    @EventListener
    public void onRegistrationConfirmed(RegistrationConfirmedEvent event) {
        outbox.enqueue(REGISTRATION_SUCCESS, event);
    }

    @EventListener
    public void onPasswordResetCodeIssued(PasswordResetCodeIssuedEvent event) {
        outbox.enqueue(PASSWORD_RESET_CODE, event);
    }

    @EventListener
    public void onPasswordResetConfirmed(PasswordResetConfirmedEvent event) {
        outbox.enqueue(PASSWORD_RESET_SUCCESS, event);
    }

    /**
     * The member-login invite.
     *
     * <p>⚠️ A failure here is NOT recoverable by resending: the raw token exists only on this
     * event (and, encrypted, on its outbox row until that row completes), and the invite row holds
     * a BCrypt hash that cannot reproduce it. The owner has to re-issue, which mints a new secret.
     * That is exactly why the failure is audited rather than logged — an invitation that silently
     * never arrived looks, from the owner's side, identical to one the recipient is ignoring.
     */
    @EventListener
    public void onMembershipInviteIssued(MembershipInviteIssuedEvent event) {
        outbox.enqueue(MEMBER_INVITE, event);
    }

    /**
     * An invitation was accepted: TWO sends, to two people, for two different reasons — and so two
     * outbox rows, because either can fail on its own, the audit trail has to say which, and a
     * retry of one must never resend the other. The owner's is the typo detector; the member's
     * carries the household name and the way out.
     */
    @EventListener
    public void onMembershipAccepted(MembershipAcceptedEvent event) {
        outbox.enqueue(MEMBER_JOINED, event);
        outbox.enqueue(MEMBER_ACCEPTED_OWNER, event);
    }

    /**
     * A login was removed, or an invitation withdrawn.
     *
     * <p>⚠️ A security control rather than a courtesy: without it somebody is silently signed out,
     * and their queued offline writes can then never land. Audited for the same reason — a notice
     * that quietly failed to send would leave them with no explanation at all.
     */
    @EventListener
    public void onMembershipRevoked(MembershipRevokedEvent event) {
        outbox.enqueue(MEMBER_REVOKED, event);
    }

    @Override
    public List<OutboxHandler<?>> outboxHandlers() {
        return List.of(
                email(VERIFICATION_CODE, VerificationCodeIssuedEvent.class, VerificationCodeIssuedEvent::email,
                        e -> emailService.sendVerificationCode(e.email(), e.rawCode()),
                        RegistrationEventType.VERIFICATION_EMAIL_SENT,
                        RegistrationEventType.VERIFICATION_EMAIL_FAILED, "verification code"),
                email(REGISTRATION_SUCCESS, RegistrationConfirmedEvent.class, RegistrationConfirmedEvent::email,
                        e -> emailService.sendRegistrationSuccess(e.email()),
                        RegistrationEventType.SUCCESS_EMAIL_SENT,
                        RegistrationEventType.SUCCESS_EMAIL_FAILED, "registration-success"),
                email(PASSWORD_RESET_CODE, PasswordResetCodeIssuedEvent.class, PasswordResetCodeIssuedEvent::email,
                        e -> emailService.sendPasswordResetCode(e.email(), e.rawCode()),
                        RegistrationEventType.PASSWORD_RESET_EMAIL_SENT,
                        RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED, "password-reset code"),
                email(PASSWORD_RESET_SUCCESS, PasswordResetConfirmedEvent.class, PasswordResetConfirmedEvent::email,
                        e -> emailService.sendPasswordResetSuccess(e.email()),
                        RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_SENT,
                        RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_FAILED, "password-reset-success"),
                email(MEMBER_INVITE, MembershipInviteIssuedEvent.class, MembershipInviteIssuedEvent::email,
                        e -> emailService.sendMembershipInvite(e.email(), e.personName(), e.accountName(),
                                e.accountNoun(), e.ownerName(), emailService.joinUrl(e.inviteId(), e.rawToken()),
                                e.recipientHasAccount()),
                        RegistrationEventType.MEMBER_INVITE_EMAIL_SENT,
                        RegistrationEventType.MEMBER_INVITE_EMAIL_FAILED, "membership invite"),
                email(MEMBER_JOINED, MembershipAcceptedEvent.class, MembershipAcceptedEvent::memberEmail,
                        e -> emailService.sendAddedToHousehold(e.memberEmail(), e.personName(), e.accountName(),
                                e.ownerName()),
                        RegistrationEventType.MEMBER_JOINED_EMAIL_SENT,
                        RegistrationEventType.MEMBER_JOINED_EMAIL_FAILED, "added to household"),
                email(MEMBER_ACCEPTED_OWNER, MembershipAcceptedEvent.class, MembershipAcceptedEvent::ownerEmail,
                        e -> emailService.sendInviteAccepted(e.ownerEmail(), e.memberEmail(), e.personName(),
                                e.accountName()),
                        RegistrationEventType.MEMBER_ACCEPTED_OWNER_EMAIL_SENT,
                        RegistrationEventType.MEMBER_ACCEPTED_OWNER_EMAIL_FAILED, "invite accepted (owner)"),
                email(MEMBER_REVOKED, MembershipRevokedEvent.class, MembershipRevokedEvent::memberEmail,
                        e -> emailService.sendLoginRevoked(e.memberEmail(), e.accountName(), e.ownerName(),
                                e.wasOnlyAnInvitation()),
                        RegistrationEventType.MEMBER_REVOKED_EMAIL_SENT,
                        RegistrationEventType.MEMBER_REVOKED_EMAIL_FAILED, "login revoked"));
    }

    // The common shape of every handler above: the send's own failure propagates (so the outbox
    // retries it); success, and the final give-up, are each recorded through recordSafely so a
    // failure to persist the audit row can never be conflated with the email itself failing.
    private <E> OutboxHandler<E> email(String name, Class<E> type, Function<E, String> recipient,
                                       EmailSend<E> send, RegistrationEventType sentType,
                                       RegistrationEventType failedType, String description) {
        return new OutboxHandler<>(name, type,
                event -> {
                    String messageId = send.execute(event);
                    recordSafely(recipient.apply(event), sentType, null, messageId);
                },
                (event, reason) -> {
                    log.error("Gave up sending {} email to {}: {}", description, recipient.apply(event), reason);
                    recordSafely(recipient.apply(event), failedType, reason, null);
                });
    }

    @FunctionalInterface
    private interface EmailSend<E> {
        String execute(E event) throws Exception;
    }

    private void recordSafely(String email, RegistrationEventType type, String detail, String messageId) {
        try {
            auditService.record(email, type, detail, null, messageId);
        } catch (Exception e) {
            log.error("Failed to persist registration-audit event {} for {} (detail={})", type, email, detail, e);
        }
    }
}
