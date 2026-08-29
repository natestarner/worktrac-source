package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.ExpiredException;
import com.worktrac.backend.common.LockedException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.ratelimit.RegistrationRateLimiter;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.security.JwtService;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.ConfirmEmailRequest;
import com.worktrac.backend.user.dto.RegisterRequest;
import com.worktrac.backend.user.dto.RegisterStartedResponse;
import com.worktrac.backend.user.dto.ResendCodeRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

// Owns the whole registration lifecycle -- register (creates a pending row + sends a code,
// never an account), confirmEmail (validates the code, only then creates the account), and
// resendCode. Kept separate from AuthService (login/me) so this class covers one
// responsibility -- provisioning new users via email verification -- rather than growing
// AuthService into a class covering five distinct concerns.
@Service
public class RegistrationService {

    private static final Logger log = LoggerFactory.getLogger(RegistrationService.class);

    private static final int MAX_ATTEMPTS = 5;
    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    private static final int MAX_RESENDS_PER_WINDOW = 5;
    private static final Duration RESEND_WINDOW = Duration.ofMinutes(15);

    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final PersonRepository personRepository;
    private final PendingRegistrationRepository pendingRegistrationRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final ApplicationEventPublisher eventPublisher;
    private final EmailProperties emailProperties;
    private final RegistrationRateLimiter rateLimiter;
    private final Optional<TestCodeCache> testCodeCache;
    private final Clock clock;
    private final RegistrationAuditService auditService;
    private final SubscriptionService subscriptionService;
    private final SecureRandom secureRandom = new SecureRandom();

    public RegistrationService(AccountRepository accountRepository, UserRepository userRepository,
                                PersonRepository personRepository,
                                PendingRegistrationRepository pendingRegistrationRepository,
                                PasswordEncoder passwordEncoder, JwtService jwtService,
                                ApplicationEventPublisher eventPublisher, EmailProperties emailProperties,
                                RegistrationRateLimiter rateLimiter, Optional<TestCodeCache> testCodeCache,
                                Clock clock, RegistrationAuditService auditService,
                                SubscriptionService subscriptionService) {
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.pendingRegistrationRepository = pendingRegistrationRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.eventPublisher = eventPublisher;
        this.emailProperties = emailProperties;
        this.rateLimiter = rateLimiter;
        this.testCodeCache = testCodeCache;
        this.clock = clock;
        this.auditService = auditService;
        this.subscriptionService = subscriptionService;
    }

    @Transactional
    public RegisterStartedResponse register(RegisterRequest request, String ipAddress) {
        String email = request.email().trim().toLowerCase();
        if (userRepository.existsByEmail(email)) {
            log.warn("Registration rejected for {} from ip {}: account already exists", email, ipAddress);
            auditService.record(email, RegistrationEventType.REGISTER_DUPLICATE_EMAIL,
                    "Account already exists", ipAddress);
            throw new ConflictException("An account with that email already exists");
        }
        checkSendAllowed(email, ipAddress, RegistrationEventType.REGISTER_RATE_LIMITED);

        String code = generateCode();
        Instant now = clock.instant();
        // flush() forces the delete to actually execute before the insert below -- Hibernate's
        // default flush ordering runs insertions before deletions within one transaction, which
        // would otherwise violate UX_pending_registrations_email when replacing a stale row for
        // the same email (confirmed by a real DataIntegrityViolationException without this).
        pendingRegistrationRepository.deleteByEmail(email);
        pendingRegistrationRepository.flush();
        PendingRegistration pending = new PendingRegistration(
                email,
                request.accountName(),
                request.personName().trim(),
                passwordEncoder.encode(request.password()),
                passwordEncoder.encode(code),
                expiresAt(now),
                now);
        pendingRegistrationRepository.save(pending);

        sendCode(email, code);
        log.info("Registration started for {} from ip {}", email, ipAddress);
        auditService.record(email, RegistrationEventType.REGISTER_STARTED, null, ipAddress);
        return new RegisterStartedResponse(email);
    }

    // noRollbackFor is required here: the wrong-code branch below saves an incremented
    // attemptCount and then throws UnauthorizedException to report the failure to the caller.
    // Spring's default @Transactional behavior rolls back on any RuntimeException, which would
    // silently discard that increment every time -- attemptCount would never actually advance
    // in the database, and the 5-attempt lockout would never trigger (confirmed by a real test
    // failure without this: a 6th attempt with the correct code succeeded instead of locking out).
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public AuthResponse confirmEmail(ConfirmEmailRequest request) {
        String email = request.email().trim().toLowerCase();
        PendingRegistration pending = pendingRegistrationRepository.findByEmail(email)
                .orElseThrow(() -> {
                    log.warn("Confirm-email failed for {}: no pending registration", email);
                    auditService.record(email, RegistrationEventType.CONFIRM_NOT_FOUND, null);
                    return new NotFoundException("No pending registration for that email");
                });

        if (pending.getExpiresAt().isBefore(clock.instant())) {
            log.warn("Confirm-email failed for {}: code expired", email);
            auditService.record(email, RegistrationEventType.CONFIRM_EXPIRED, null);
            throw new ExpiredException("This code has expired -- request a new one");
        }
        if (pending.getAttemptCount() >= MAX_ATTEMPTS) {
            log.warn("Confirm-email failed for {}: locked out after {} incorrect attempts", email, MAX_ATTEMPTS);
            auditService.record(email, RegistrationEventType.CONFIRM_LOCKED,
                    "Locked out after " + MAX_ATTEMPTS + " incorrect attempts");
            throw new LockedException("Too many incorrect attempts -- request a new code");
        }
        if (!passwordEncoder.matches(request.code(), pending.getCodeHash())) {
            pending.incrementAttemptCount();
            pendingRegistrationRepository.save(pending);
            log.warn("Confirm-email failed for {}: incorrect code (attempt {})", email, pending.getAttemptCount());
            // This audit row must survive the throw below -- see confirmEmail's
            // noRollbackFor comment and RegistrationAuditService's own REQUIRES_NEW comment.
            auditService.record(email, RegistrationEventType.CONFIRM_WRONG_CODE,
                    "Incorrect code (attempt " + pending.getAttemptCount() + " of " + MAX_ATTEMPTS + ")");
            throw new UnauthorizedException("Incorrect code");
        }

        // Race guard: another confirm/register could have taken this email between when this
        // request started and now.
        if (userRepository.existsByEmail(email)) {
            log.warn("Confirm-email failed for {}: account already exists (race)", email);
            auditService.record(email, RegistrationEventType.REGISTER_DUPLICATE_EMAIL,
                    "Account already exists (detected during confirm-email race check)");
            throw new ConflictException("An account with that email already exists");
        }

        AuthResponse response = createAccountUserPerson(
                email, pending.getPasswordHash(), pending.getPersonName(), pending.getAccountName());
        pendingRegistrationRepository.deleteByEmail(email);
        eventPublisher.publishEvent(new RegistrationConfirmedEvent(email));
        log.info("Registration confirmed for {}", email);
        auditService.record(email, RegistrationEventType.CONFIRM_SUCCESS,
                "Account created (accountId=" + response.account().id() + ")");
        return response;
    }

    @Transactional
    public void resendCode(ResendCodeRequest request, String ipAddress) {
        String email = request.email().trim().toLowerCase();
        PendingRegistration pending = pendingRegistrationRepository.findByEmail(email)
                .orElseThrow(() -> {
                    log.warn("Resend-code failed for {} from ip {}: no pending registration", email, ipAddress);
                    auditService.record(email, RegistrationEventType.RESEND_NOT_FOUND, null, ipAddress);
                    return new NotFoundException("No pending registration for that email");
                });

        Instant now = clock.instant();
        if (pending.getLastSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            log.warn("Resend-code rejected for {} from ip {}: cooldown active", email, ipAddress);
            auditService.record(email, RegistrationEventType.RESEND_THROTTLED, "Cooldown active", ipAddress);
            throw new TooManyRequestsException("Please wait before requesting another code");
        }
        if (pending.getResendCount() >= MAX_RESENDS_PER_WINDOW
                && pending.getLastSentAt().plus(RESEND_WINDOW).isAfter(now)) {
            log.warn("Resend-code rejected for {} from ip {}: resend window limit reached", email, ipAddress);
            auditService.record(email, RegistrationEventType.RESEND_THROTTLED,
                    "Resend window limit reached (" + MAX_RESENDS_PER_WINDOW + " per " + RESEND_WINDOW.toMinutes()
                            + " min)", ipAddress);
            throw new TooManyRequestsException("Too many code requests -- please try again later");
        }
        checkSendAllowed(email, ipAddress, RegistrationEventType.REGISTER_RATE_LIMITED);

        String code = generateCode();
        pending.setCodeHash(passwordEncoder.encode(code));
        pending.setExpiresAt(expiresAt(now));
        pending.resetAttemptCount();
        pending.setLastSentAt(now);
        pending.incrementResendCount();
        pendingRegistrationRepository.save(pending);

        sendCode(email, code);
        log.info("Code resent for {} from ip {}", email, ipAddress);
        auditService.record(email, RegistrationEventType.RESEND_REQUESTED,
                "Resend #" + pending.getResendCount(), ipAddress);
    }

    private Instant expiresAt(Instant now) {
        return now.plus(Duration.ofMinutes(emailProperties.getCodeExpirationMinutes()));
    }

    // eventType lets the two call sites (register vs resendCode) record under the same rate-
    // limit event category while the detail string still says which check tripped.
    private void checkSendAllowed(String email, String ipAddress, RegistrationEventType eventType) {
        if (!rateLimiter.tryConsumeGlobal()) {
            log.warn("Registration email send blocked by global rate limit for {} from ip {}", email, ipAddress);
            auditService.record(email, eventType, "Global email send rate limit exceeded", ipAddress);
            throw new TooManyRequestsException(
                    "Too many verification emails sent recently -- please try again later");
        }
        if (!rateLimiter.tryConsumePerIp(ipAddress)) {
            log.warn("Registration email send blocked by per-IP rate limit for {} from ip {}", email, ipAddress);
            auditService.record(email, eventType, "Per-IP rate limit exceeded (ip " + ipAddress + ")", ipAddress);
            throw new TooManyRequestsException("Too many requests from this address -- please try again later");
        }
    }

    private String generateCode() {
        return String.format("%06d", secureRandom.nextInt(1_000_000));
    }

    private void sendCode(String email, String rawCode) {
        // Populate the test-only cache synchronously (before the email dispatch, which is now
        // async) -- e2e tests and RegistrationTestSupport read this immediately after the HTTP
        // response returns and never wait on the actual email send.
        testCodeCache.ifPresent(cache -> cache.put(email, rawCode));
        eventPublisher.publishEvent(new VerificationCodeIssuedEvent(email, rawCode));
    }

    private AuthResponse createAccountUserPerson(String email, String passwordHash, String personName,
                                                  String accountNameRaw) {
        String accountName = accountNameRaw == null || accountNameRaw.isBlank()
                ? personName + "'s Household"
                : accountNameRaw.trim();

        Account account = accountRepository.save(new Account(accountName));
        User user = userRepository.save(new User(account, email, passwordHash));
        Person person = personRepository.save(new Person(account, personName, true));
        // Every account owns exactly one subscription row from the moment it exists, so "one row
        // per account" is true from here on rather than only for households that reach billing.
        // Nothing here talks to Stripe: a Stripe outage must never be able to break registration,
        // and the Stripe Customer is created lazily at first checkout instead.
        subscriptionService.createFreeSubscription(account);

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(), user.getRole());
        return new AuthResponse(token, UserDto.from(user), AccountDto.from(account, BillingPlan.FREE),
                PersonDto.from(person));
    }
}
