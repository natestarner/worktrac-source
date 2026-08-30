package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.LockedException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.ratelimit.LoginRateLimiter;
import com.worktrac.backend.security.JwtService;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.LoginRequest;
import com.worktrac.backend.user.dto.MeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String ROLE_USER = "USER";

    // Ten wrong passwords locks the account for fifteen minutes. Deliberately looser than the
    // five-attempt caps on the verification and reset CODES: those guard a 6-digit secret that was
    // just emailed and is fresh in someone's mind, while this guards a password a family shares
    // across devices and may genuinely fumble. Fifteen minutes is long enough to make guessing
    // pointless and short enough that nobody needs support to get back in.
    private static final int MAX_FAILED_LOGINS = 10;
    private static final Duration LOCKOUT_DURATION = Duration.ofMinutes(15);

    // BCrypt hash of a value nothing can match, used to spend the same ~100ms on an unknown email
    // as on a known one. Without it, login answered in about a millisecond for an address with no
    // account and about a hundred for one with -- a timing oracle that, combined with the complete
    // absence of a rate limit, let anyone enumerate the whole user base at speed.
    private static final String DUMMY_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final PersonRepository personRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AdminProperties adminProperties;
    private final SubscriptionService subscriptionService;
    private final LoginRateLimiter loginRateLimiter;
    private final Clock clock;

    public AuthService(AccountRepository accountRepository, UserRepository userRepository,
                        PersonRepository personRepository, PasswordEncoder passwordEncoder,
                        JwtService jwtService, AdminProperties adminProperties,
                        SubscriptionService subscriptionService, LoginRateLimiter loginRateLimiter,
                        Clock clock) {
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.adminProperties = adminProperties;
        this.subscriptionService = subscriptionService;
        this.loginRateLimiter = loginRateLimiter;
        this.clock = clock;
    }

    // noRollbackFor is required here for the same reason it is on RegistrationService.confirmEmail
    // and PasswordResetService.confirmReset: the wrong-password branch saves an incremented
    // attempt count and then throws to report the failure. Spring's default rollback-on-
    // RuntimeException would silently discard that increment, so the count would never advance in
    // the database and the lockout would never fire.
    @Transactional(noRollbackFor = {UnauthorizedException.class, LockedException.class})
    public AuthResponse login(LoginRequest request, String ipAddress) {
        // FIRST, before the lookup and before any BCrypt work. Every attempt costs ~100ms of CPU,
        // so a flood must be refused without paying for it -- this ordering is what makes the
        // limiter a DoS defence and not just an anti-guessing one. Do not move it below.
        checkLoginAllowed(ipAddress);

        String email = request.email().trim().toLowerCase();
        Instant now = clock.instant();

        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            // Spend the same time as a real verification would, then fail identically. See
            // DUMMY_HASH -- returning early here is what made login a user-enumeration oracle.
            passwordEncoder.matches(request.password(), DUMMY_HASH);
            throw new UnauthorizedException("Invalid email or password");
        }

        // Checked BEFORE the password comparison, so a locked account costs no BCrypt either.
        if (user.isLockedAt(now)) {
            log.warn("Login refused for {} from ip {}: account locked until {}",
                    email, ipAddress, user.getLockedUntil());
            throw new LockedException("Too many failed attempts. Try again in a few minutes,"
                    + " or reset your password to get back in right away.");
        }

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            user.recordFailedLogin(MAX_FAILED_LOGINS, now, LOCKOUT_DURATION);
            userRepository.save(user);
            if (user.getLockedUntil() != null) {
                log.warn("Locked account {} until {} after {} failed logins (latest from ip {})",
                        email, user.getLockedUntil(), MAX_FAILED_LOGINS, ipAddress);
            }
            throw new UnauthorizedException("Invalid email or password");
        }

        user.clearLoginLockout();
        reconcileAdminRole(user);
        Account account = user.getAccount();
        Person primaryPerson = personRepository.findByAccount_IdOrderByCreatedAtAsc(account.getId()).stream()
                .filter(Person::isPrimary)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Account has no primary person: " + account.getId()));

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(), user.getRole(), user.getTokenVersion());
        return new AuthResponse(token, UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(account.getId())),
                PersonDto.from(primaryPerson));
    }

    // Narrowest bucket first, matching ContactRateLimiter's ordering and for the same reason: a
    // single abuser should exhaust their own allowance before touching the shared one.
    private void checkLoginAllowed(String ipAddress) {
        if (!loginRateLimiter.tryConsumePerIp(ipAddress)) {
            log.warn("Login blocked by per-IP rate limit from ip {}", ipAddress);
            throw new TooManyRequestsException("Too many sign-in attempts from this address -- please try again later.");
        }
        if (!loginRateLimiter.tryConsumeGlobal()) {
            log.warn("Login blocked by global rate limit (ip {})", ipAddress);
            throw new TooManyRequestsException("We're seeing a lot of sign-in attempts right now -- please try again shortly.");
        }
    }

    // ADMIN_EMAILS is the real source of truth for who's an admin; the `role` column is
    // just a cache of it. Reconciling here (rather than only at startup, see
    // AdminBootstrap) means removing someone from the allowlist takes effect on their
    // very next login even without an app restart.
    private void reconcileAdminRole(User user) {
        boolean shouldBeAdmin = adminProperties.isAdminEmail(user.getEmail());
        String targetRole = shouldBeAdmin ? ROLE_ADMIN : ROLE_USER;
        if (!targetRole.equals(user.getRole())) {
            user.setRole(targetRole);
            userRepository.save(user);
        }
    }

    @Transactional(readOnly = true)
    public MeResponse me(Long userId, Long accountId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("User no longer exists"));
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new UnauthorizedException("Account no longer exists"));
        List<PersonDto> people = personRepository.findByAccount_IdOrderByCreatedAtAsc(accountId).stream()
                .map(PersonDto::from)
                .toList();
        return new MeResponse(UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(accountId)), people);
    }
}
