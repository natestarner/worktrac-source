package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.LockedException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembership;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.HouseholdChoiceDto;
import com.worktrac.backend.membership.MembershipDto;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.person.PersonService;
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
    private final AccountMembershipRepository membershipRepository;
    private final PersonService personService;
    private final Clock clock;

    public AuthService(AccountRepository accountRepository, UserRepository userRepository,
                        PersonRepository personRepository, PasswordEncoder passwordEncoder,
                        JwtService jwtService, AdminProperties adminProperties,
                        SubscriptionService subscriptionService, LoginRateLimiter loginRateLimiter,
                        AccountMembershipRepository membershipRepository, PersonService personService,
                        Clock clock) {
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.adminProperties = adminProperties;
        this.subscriptionService = subscriptionService;
        this.loginRateLimiter = loginRateLimiter;
        this.membershipRepository = membershipRepository;
        this.personService = personService;
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

        // Which household is this login signing in to? Phase 2 has exactly one membership per
        // user, because the only thing that creates one is registration. Phase 6 turns two-or-more
        // into an account picker; until then the oldest is the only one and taking it is exact.
        //
        // Zero is not a "shouldn't happen" -- it is what a revoked member sees, and it must not be
        // an enumeration oracle: they proved the password, so telling them their access is gone
        // reveals nothing they didn't already know.
        List<AccountMembership> memberships = membershipRepository.findByUser_IdOrderByCreatedAtAscIdAsc(user.getId());
        if (memberships.isEmpty()) {
            log.warn("Login for {} from ip {} succeeded but the user has no membership", email, ipAddress);
            throw new UnauthorizedException("That login is no longer attached to a household.");
        }

        // Two or more households: the password is proved but the account is not chosen, so there is
        // nothing to put in a token's accountId yet. Hand back the choices and a five-minute proof,
        // and let POST /api/auth/session mint the real thing.
        //
        // ⚠️ Not an enumeration risk, and it is worth being precise about why: everything below is
        // about the caller's OWN memberships, revealed only after their own password was accepted.
        // Nothing here says anything about an address that failed, which is the thing DUMMY_HASH
        // and the uniform failure path exist to protect.
        //
        // The one-household path below is untouched and returns byte-for-byte what it always has.
        if (memberships.size() > 1) {
            log.info("Login for {} from ip {} resolved to {} households; returning a picker",
                    email, ipAddress, memberships.size());
            return AuthResponse.chooseHousehold(
                    UserDto.from(user),
                    memberships.stream().map(HouseholdChoiceDto::from).toList(),
                    jwtService.generateSelectionToken(user.getId(), user.getEmail(), user.getTokenVersion()));
        }

        AccountMembership membership = memberships.get(0);
        Account account = membership.getAccount();

        // The membership's own person when it has one, falling back to the account's primary. The
        // fallback matters for accounts created before V64 attached a person, and for an owner
        // whose person was removed -- neither should be unable to sign in.
        Person primaryPerson = membership.getPerson() != null
                ? membership.getPerson()
                : personRepository.findByAccount_IdOrderByCreatedAtAsc(account.getId()).stream()
                        .filter(Person::isPrimary)
                        .findFirst()
                        .orElseThrow(() -> new IllegalStateException("Account has no primary person: " + account.getId()));

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(), user.getRole(), user.getTokenVersion());
        return AuthResponse.signedIn(token, UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(account.getId())),
                MembershipDto.from(membership,
                        ownerNameForMember(account.getId(), membership.getAccountRole()),
                        subscriptionService.isPro(account.getId())),
                PersonDto.from(primaryPerson));
    }

    /**
     * Finishes a sign-in that needed a household chosen, and doubles as "switch household".
     *
     * <p>Takes a user that some caller has already authenticated — either by a selection token
     * (finishing a login) or by a full session token (switching). <b>No password is involved
     * either way</b>, which is why the membership check below is the entire security of this
     * method: it is the only thing standing between a signed-in person and any account id they
     * care to type.
     *
     * <p>404, not 403, for a household they are not in. A membership they do not hold is not
     * information they are entitled to distinguish from one that does not exist — the same
     * non-distinguishing shape {@code PersonService.requireVisiblePerson} uses one boundary in.
     */
    @Transactional
    public AuthResponse startSession(Long userId, Long accountId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer valid."));

        AccountMembership membership = membershipRepository
                .findByAccount_IdAndUser_Id(accountId, userId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that household."));

        Account account = membership.getAccount();
        Person primaryPerson = membership.getPerson() != null
                ? membership.getPerson()
                : personRepository.findByAccount_IdOrderByCreatedAtAsc(account.getId()).stream()
                        .filter(Person::isPrimary)
                        .findFirst()
                        .orElseThrow(() -> new IllegalStateException("Account has no primary person: " + account.getId()));

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(),
                user.getRole(), user.getTokenVersion());
        return AuthResponse.signedIn(token, UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(account.getId())),
                MembershipDto.from(membership,
                        ownerNameForMember(account.getId(), membership.getAccountRole()),
                        subscriptionService.isPro(account.getId())),
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
    public MeResponse me(AccountAccess access) {
        Long accountId = access.accountId();
        User user = userRepository.findById(access.userId())
                .orElseThrow(() -> new UnauthorizedException("User no longer exists"));
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new UnauthorizedException("Account no longer exists"));
        // Through PersonService, so the visibility filter lives in exactly one place. Reading the
        // repository directly here would hand every member the full household roster through the
        // one endpoint the whole client bootstraps from.
        // Every household this LOGIN belongs to, current one included -- so the account menu can
        // offer "Switch household" only when there is somewhere to go. Scoped to the caller's own
        // user id, so it reveals nothing but their own memberships.
        List<HouseholdChoiceDto> households = membershipRepository
                .findByUser_IdOrderByCreatedAtAscIdAsc(access.userId())
                .stream()
                .map(HouseholdChoiceDto::from)
                .toList();
        return new MeResponse(UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(accountId)),
                MembershipDto.from(access, ownerNameForMember(accountId, access.accountRole())),
                personService.list(access),
                households);
    }

    /**
     * The household owner's person name, for the one audience that needs it: a MEMBER.
     *
     * <p>Answers "who do I ask?" — and carries the copy weight in every refusal a member can hit,
     * because "ask Nate to rename it" is only actionable if the app can say who Nate is.
     *
     * <p><b>Null for an owner, deliberately, and that is not just tidiness.</b> An owner already
     * knows who the owner is, so resolving it for them would buy nothing and cost a query on
     * {@code /me} — the hottest endpoint in the app — for every single existing user, all of whom
     * are owners today. Members are the rare case, and they are the only case that pays.
     *
     * <p>Null is also the honest answer for an account with no owner membership, or an owner
     * membership with no person. Every consumer must degrade to a message that names nobody
     * rather than printing "null".
     */
    private String ownerNameForMember(Long accountId, AccountRole role) {
        if (role != AccountRole.MEMBER) {
            return null;
        }
        return membershipRepository.findOwnerPersonNames(accountId, AccountRole.OWNER).stream()
                .findFirst()
                .orElse(null);
    }
}
