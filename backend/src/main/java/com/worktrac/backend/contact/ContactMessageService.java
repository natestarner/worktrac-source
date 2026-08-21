package com.worktrac.backend.contact;

import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.ratelimit.ContactRateLimiter;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

// Accepts a Contact Us submission. The whole design turns on one ordering decision: the message row
// COMMITS SYNCHRONOUSLY on the request thread, and only then is the admin alert email dispatched
// asynchronously. docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md is why -- when
// the email executor saturated, every record that lived inside the async task vanished with it, and
// the only thing that survived was the row already committed in the request's own transaction.
//
// So: the email can fail, the executor can saturate, ACS can be down, and the message is still
// there to read in the admin portal. The reverse ordering would make the person's report contingent
// on a mail server.
@Service
public class ContactMessageService {

    private static final Logger log = LoggerFactory.getLogger(ContactMessageService.class);

    // A resubmit of the same text inside this window is treated as the same message. Long enough to
    // cover a double-tap, an impatient retry, or a flaky connection; short enough that genuinely
    // writing the same short subject again tomorrow still gets through.
    private static final Duration DUPLICATE_WINDOW = Duration.ofMinutes(5);

    private final ContactMessageRepository contactMessageRepository;
    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final PersonService personService;
    private final ContactRateLimiter rateLimiter;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;

    public ContactMessageService(ContactMessageRepository contactMessageRepository,
                                  AccountRepository accountRepository, UserRepository userRepository,
                                  PersonService personService, ContactRateLimiter rateLimiter,
                                  ApplicationEventPublisher eventPublisher, Clock clock) {
        this.contactMessageRepository = contactMessageRepository;
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personService = personService;
        this.rateLimiter = rateLimiter;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    @Transactional
    public void submit(Long accountId, Long userId, ContactRequest request, String ipAddress,
                        String userAgent, String correlationId) {
        checkAllowed(userId, ipAddress);

        String subject = request.subject().trim();
        String message = request.message().trim();

        // Idempotent resubmit, NOT a 409. A double-tap or a retry after a flaky response is the
        // common case, and answering it with an error would tell the person their message failed
        // when it is sitting in the inbox. Returning success without a second insert also means a
        // rage-click can't multiply email volume.
        Instant duplicateCutoff = clock.instant().minus(DUPLICATE_WINDOW);
        if (contactMessageRepository.existsByUser_IdAndSubjectAndMessageAndCreatedAtAfter(
                userId, subject, message, duplicateCutoff)) {
            log.info("Suppressed duplicate contact message from user {} (correlationId={})", userId, correlationId);
            return;
        }

        // The account-scoping guard every service with a client-supplied personId calls first. 404s
        // (not 403s) on another account's person, so a caller can never distinguish "doesn't exist"
        // from "not yours".
        Person person = request.personId() == null
                ? null
                : personService.requireOwnedPerson(request.personId(), accountId);

        User user = userRepository.getReferenceById(userId);
        ContactMessage contactMessage = new ContactMessage(
                accountRepository.getReferenceById(accountId),
                user,
                person,
                // From the authenticated user, never from the request body -- see ContactMessage.
                user.getEmail(),
                request.category(),
                subject,
                message,
                clock.instant());

        contactMessage.setIpAddress(ipAddress);
        contactMessage.setUserAgent(truncate(userAgent, 255));
        contactMessage.setCorrelationId(truncate(correlationId, 64));
        applyDiagnostics(contactMessage, request.diagnostics());

        ContactMessage saved = contactMessageRepository.save(contactMessage);

        // AFTER_COMMIT on the listener side, so this publish is a no-op if the transaction rolls
        // back -- an email about a message that was never stored would be the worst of both.
        eventPublisher.publishEvent(new ContactMessageReceivedEvent(saved.getId(), saved.getCategory(),
                saved.getSubject(), saved.getMessage(), saved.getSubmitterEmail(), saved.getCorrelationId()));
    }

    @Transactional(readOnly = true)
    public List<ContactMessage> listRecent() {
        return contactMessageRepository.findTop500ByOrderByCreatedAtDesc();
    }

    // Narrowest bucket first -- see ContactRateLimiter for why the order is load-bearing. Each
    // branch names the specific limiter that tripped rather than a generic "too many requests", so
    // a 429 in the logs is actionable.
    private void checkAllowed(Long userId, String ipAddress) {
        if (!rateLimiter.tryConsumePerUser(userId)) {
            log.warn("Contact message blocked by per-user rate limit for user {} from ip {}", userId, ipAddress);
            throw new TooManyRequestsException(
                    "You've sent a few messages already -- please try again a little later.");
        }
        if (!rateLimiter.tryConsumePerIp(ipAddress)) {
            log.warn("Contact message blocked by per-IP rate limit for user {} from ip {}", userId, ipAddress);
            throw new TooManyRequestsException("Too many requests from this address -- please try again later.");
        }
        if (!rateLimiter.tryConsumeGlobal()) {
            log.warn("Contact message blocked by global rate limit for user {} from ip {}", userId, ipAddress);
            throw new TooManyRequestsException("We're getting a lot of messages right now -- please try again later.");
        }
    }

    private void applyDiagnostics(ContactMessage contactMessage, ContactDiagnostics diagnostics) {
        if (diagnostics == null) {
            return;
        }
        contactMessage.setAppBuild(diagnostics.appBuild());
        contactMessage.setScreen(diagnostics.screen());
        contactMessage.setWasOnline(diagnostics.wasOnline());
        contactMessage.setUnsyncedWrites(diagnostics.unsyncedWrites());
        contactMessage.setClientError(diagnostics.clientError());
    }

    // userAgent and correlationId come from request headers, which carry no bean-validation
    // constraints -- an oversized header would otherwise be a DB error rather than a stored row.
    private String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
