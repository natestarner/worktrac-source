package com.worktrac.backend.user;

import com.worktrac.backend.common.ExpiredException;
import com.worktrac.backend.common.LockedException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.ratelimit.RegistrationRateLimiter;
import com.worktrac.backend.user.dto.ForgotPasswordRequest;
import com.worktrac.backend.user.dto.ResendResetCodeRequest;
import com.worktrac.backend.user.dto.ResetPasswordRequest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

// Owns the whole password-reset lifecycle -- request (emails a 6-digit code, mirroring
// RegistrationService's verification-code flow), confirm (validates the code, then updates the
// user's password), and resend. Deliberately non-enumerating throughout: an unregistered email
// must look identical, at every step and under every failure mode, to a registered one that
// simply hasn't requested a reset -- otherwise this endpoint becomes an oracle for which emails
// have accounts.
@Service
public class PasswordResetService {

    private static final int MAX_ATTEMPTS = 5;
    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    private static final int MAX_RESENDS_PER_WINDOW = 5;
    private static final Duration RESEND_WINDOW = Duration.ofMinutes(15);

    private final UserRepository userRepository;
    private final PasswordResetCodeRepository passwordResetCodeRepository;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher eventPublisher;
    private final EmailProperties emailProperties;
    private final RegistrationRateLimiter rateLimiter;
    private final Optional<TestCodeCache> testCodeCache;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(UserRepository userRepository,
                                 PasswordResetCodeRepository passwordResetCodeRepository,
                                 PasswordEncoder passwordEncoder,
                                 ApplicationEventPublisher eventPublisher,
                                 EmailProperties emailProperties,
                                 RegistrationRateLimiter rateLimiter,
                                 Optional<TestCodeCache> testCodeCache,
                                 Clock clock) {
        this.userRepository = userRepository;
        this.passwordResetCodeRepository = passwordResetCodeRepository;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
        this.emailProperties = emailProperties;
        this.rateLimiter = rateLimiter;
        this.testCodeCache = testCodeCache;
        this.clock = clock;
    }

    // Always returns normally and never throws for an unknown email -- checkSendAllowed runs
    // before the existsByEmail check specifically so an unregistered email consumes the same
    // rate-limit quota a registered one would. If it ran only on the known-email branch, an
    // attacker could distinguish "known" from "unknown" by noticing which emails eventually
    // 429 under repeated requests and which never do.
    @Transactional
    public void requestReset(ForgotPasswordRequest request, String ipAddress) {
        String email = request.email().trim().toLowerCase();
        checkSendAllowed(ipAddress);

        if (!userRepository.existsByEmail(email)) {
            return;
        }

        String code = generateCode();
        Instant now = clock.instant();
        // flush() forces the delete to actually execute before the insert below -- Hibernate's
        // default flush ordering runs insertions before deletions within one transaction, which
        // would otherwise violate UX_password_reset_codes_email when replacing a stale row for
        // the same email (same reasoning as RegistrationService.register()).
        passwordResetCodeRepository.deleteByEmail(email);
        passwordResetCodeRepository.flush();
        PasswordResetCode resetCode = new PasswordResetCode(email, passwordEncoder.encode(code), expiresAt(now), now);
        passwordResetCodeRepository.save(resetCode);

        sendCode(email, code);
    }

    // noRollbackFor is required here for the same reason as RegistrationService.confirmEmail:
    // the wrong-code branch saves an incremented attemptCount and then throws, and Spring's
    // default rollback-on-RuntimeException behavior would otherwise silently discard that
    // increment, so the 5-attempt lockout would never trigger.
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public void confirmReset(ResetPasswordRequest request) {
        String email = request.email().trim().toLowerCase();
        // Same generic message as a wrong code below -- a missing row (no reset was ever
        // requested for this email) must not be distinguishable from a wrong code entered
        // against a real, outstanding one.
        PasswordResetCode resetCode = passwordResetCodeRepository.findByEmail(email)
                .orElseThrow(() -> new UnauthorizedException("Invalid or expired code"));

        if (resetCode.getExpiresAt().isBefore(clock.instant())) {
            throw new ExpiredException("This code has expired -- request a new one");
        }
        if (resetCode.getAttemptCount() >= MAX_ATTEMPTS) {
            throw new LockedException("Too many incorrect attempts -- request a new code");
        }
        if (!passwordEncoder.matches(request.code(), resetCode.getCodeHash())) {
            resetCode.incrementAttemptCount();
            passwordResetCodeRepository.save(resetCode);
            throw new UnauthorizedException("Invalid or expired code");
        }

        // The row can only exist for an email that had an account at request time (requestReset
        // never creates one otherwise), but the user could theoretically be deleted in between --
        // fall back to the same generic error rather than a distinct 404.
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new UnauthorizedException("Invalid or expired code"));
        user.updatePasswordHash(passwordEncoder.encode(request.password()));
        userRepository.save(user);
        passwordResetCodeRepository.deleteByEmail(email);

        eventPublisher.publishEvent(new PasswordResetConfirmedEvent(email));
    }

    // Silently returns if no reset is outstanding for this email, mirroring requestReset's
    // non-enumerating behavior -- unlike RegistrationService.resendCode (which 404s on a
    // missing pending registration), a missing row here must not be observable, since its
    // presence is gated on the email having a real account.
    @Transactional
    public void resendResetCode(ResendResetCodeRequest request, String ipAddress) {
        String email = request.email().trim().toLowerCase();
        Optional<PasswordResetCode> maybeResetCode = passwordResetCodeRepository.findByEmail(email);
        if (maybeResetCode.isEmpty()) {
            return;
        }
        PasswordResetCode resetCode = maybeResetCode.get();

        Instant now = clock.instant();
        if (resetCode.getLastSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            throw new TooManyRequestsException("Please wait before requesting another code");
        }
        if (resetCode.getResendCount() >= MAX_RESENDS_PER_WINDOW
                && resetCode.getLastSentAt().plus(RESEND_WINDOW).isAfter(now)) {
            throw new TooManyRequestsException("Too many code requests -- please try again later");
        }
        checkSendAllowed(ipAddress);

        String code = generateCode();
        resetCode.setCodeHash(passwordEncoder.encode(code));
        resetCode.setExpiresAt(expiresAt(now));
        resetCode.resetAttemptCount();
        resetCode.setLastSentAt(now);
        resetCode.incrementResendCount();
        passwordResetCodeRepository.save(resetCode);

        sendCode(email, code);
    }

    private Instant expiresAt(Instant now) {
        return now.plus(Duration.ofMinutes(emailProperties.getCodeExpirationMinutes()));
    }

    private void checkSendAllowed(String ipAddress) {
        if (!rateLimiter.tryConsumeGlobal()) {
            throw new TooManyRequestsException("Too many emails sent recently -- please try again later");
        }
        if (!rateLimiter.tryConsumePerIp(ipAddress)) {
            throw new TooManyRequestsException("Too many requests from this address -- please try again later");
        }
    }

    private String generateCode() {
        return String.format("%06d", secureRandom.nextInt(1_000_000));
    }

    private void sendCode(String email, String rawCode) {
        // Populate the test-only cache synchronously (before the email dispatch, which is now
        // async) -- e2e tests read this immediately after the HTTP response returns and never
        // wait on the actual email send. Shared with RegistrationService's use of the same
        // cache; a plain email-keyed map, so the two flows can't collide as long as a test
        // doesn't request both a verification code and a reset code for the same address at
        // once.
        testCodeCache.ifPresent(cache -> cache.put(email, rawCode));
        eventPublisher.publishEvent(new PasswordResetCodeIssuedEvent(email, rawCode));
    }
}
