package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ForbiddenException;
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
import com.worktrac.backend.membership.MembershipInvite;
import com.worktrac.backend.membership.MembershipInviteService;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.ratelimit.LoginRateLimiter;
import com.worktrac.backend.security.JwtService;
import com.worktrac.backend.user.dto.AcceptInviteRequest;
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
import java.util.function.Supplier;

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
    // Package-visible so RateLimitPropertiesTest can assert the per-email rate limit stays ABOVE
    // it -- see that test for why the two numbers are a pair rather than independent knobs.
    static final int MAX_FAILED_LOGINS = 10;
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
    // One-way edge: MembershipInviteService knows nothing about AuthService, so there is no cycle.
    // Accepting an invitation is a CREDENTIAL operation that happens to attach a membership, not a
    // membership operation that happens to mint a token -- which is exactly why the orchestration
    // lives here, beside the rate limiter and the lockout, rather than there.
    private final MembershipInviteService inviteService;
    private final Clock clock;

    public AuthService(AccountRepository accountRepository, UserRepository userRepository,
                        PersonRepository personRepository, PasswordEncoder passwordEncoder,
                        JwtService jwtService, AdminProperties adminProperties,
                        SubscriptionService subscriptionService, LoginRateLimiter loginRateLimiter,
                        AccountMembershipRepository membershipRepository, PersonService personService,
                        MembershipInviteService inviteService,
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
        this.inviteService = inviteService;
        this.clock = clock;
    }

    // noRollbackFor is required here for the same reason it is on RegistrationService.confirmEmail
    // and PasswordResetService.confirmReset: the wrong-password branch saves an incremented
    // attempt count and then throws to report the failure. Spring's default rollback-on-
    // RuntimeException would silently discard that increment, so the count would never advance in
    // the database and the lockout would never fire.
    @Transactional(noRollbackFor = {UnauthorizedException.class, LockedException.class})
    public AuthResponse login(LoginRequest request, String ipAddress) {
        String email = request.email().trim().toLowerCase();

        // 401 here, not 403: on THIS route the password IS the session credential, so "that wasn't
        // right" and "you have no session" are the same statement. api/client.js only reads a 401
        // as an expired session when the request carried a token, and a sign-in carries none.
        User user = verifyCredentials(email, request.password(), ipAddress,
                () -> new UnauthorizedException("Invalid email or password"));

        reconcileAdminRole(user);
        return sessionOrPicker(user);
    }

    /**
     * Finishes an invitation: proves who the invitee is, attaches the membership, and answers with
     * the same two shapes a login does.
     *
     * <p>⚠️ <b>THE HOLE THIS CLOSED, because the shortcut is very tempting.</b> This used to be
     * three lines in {@code AuthController}: verify the emailed token, attach the membership, mint
     * a session. For an address that already had a Huddle account that meant a <b>full 30-day
     * session token with no credential check whatsoever</b> — and since {@code POST
     * /api/auth/session} takes a session token, its holder could then switch into every other
     * household that person belonged to, their own included. Any household owner could cause a
     * link with that power to be mailed to any address they could type, live for seven days and
     * re-sendable five times. An invitation must attach a membership, never hand over an identity.
     *
     * <p><b>So an address that already exists has to prove itself, and there are exactly two ways
     * to do that.</b> A password, checked through {@link #verifyCredentials} so it carries the same
     * rate limiting and the same lockout as {@code /login} — without which this route would be an
     * unthrottled password oracle sitting next to the throttled one. Or an existing session
     * belonging to that same address, which is the STRONGER proof of the two: a principal only
     * reaches the security context after {@code JwtAuthenticationFilter} has checked the
     * signature, refused anything carrying {@code scp}, and resolved the token's {@code tv} against
     * the live user row. Being signed in as somebody ELSE proves nothing about the invitee and is
     * refused — the client offers to switch rather than silently swapping identity.
     *
     * <p><b>A brand-new address is unchanged</b>: it is choosing a password, not proving one, and
     * the emailed token is the only credential it can have.
     *
     * <p><b>Every refusal is a 403</b>, never a 401 — see {@code MembershipInviteService.rejected}.
     *
     * <p>{@code noRollbackFor} covers all three, because every one of them can be thrown after a
     * counter has been incremented and saved: the invite's {@code attemptCount} in
     * {@link MembershipInviteService#requireValidInvite}, or the user's
     * {@code failedLoginAttempts} in {@link #verifyCredentials}. Dropping one silently disarms the
     * ceiling it guards.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, ForbiddenException.class, LockedException.class})
    public AuthResponse acceptInvite(AcceptInviteRequest request, String ipAddress, Long signedInUserId) {
        MembershipInvite invite = inviteService.requireValidInvite(request.inviteId(), request.token());
        String email = invite.getEmail();

        User user = userRepository.findByEmail(email)
                .map(existing -> proveInvitedIdentity(existing, request.password(), ipAddress, signedInUserId))
                .orElseGet(() -> createInvitedUser(email, request.password()));

        inviteService.attach(invite, user);
        reconcileAdminRole(user);

        // The SAME branch a login takes, deliberately. A brand-new address now has exactly one
        // membership and is signed straight in, byte-for-byte as before; an address that already
        // had a household has two or more and gets the household picker -- the screen it would
        // have seen on its very next sign-in anyway. That is the whole reason this returns
        // AuthResponse rather than a shape of its own: no new client vocabulary, no new journey.
        return sessionOrPicker(user);
    }

    /**
     * An invited address that already exists must prove it is the person behind that address.
     *
     * <p>Order matters: the session check first, because it is both the stronger proof and the one
     * that costs nothing. Falling through to the password is what makes a signed-out invitee — the
     * ordinary case — work at all.
     */
    private User proveInvitedIdentity(User user, String password, String ipAddress, Long signedInUserId) {
        if (signedInUserId != null && signedInUserId.equals(user.getId())) {
            log.info("Invite accepted by user {} using their existing session", user.getId());
            return user;
        }

        // ⚠️ Refused BEFORE verifyCredentials, so a missing password costs the invitee nothing.
        // Falling through would spend one of their ten login attempts and one of their rate-limit
        // tokens on a request that carried no guess at all -- which hands anyone who can open the
        // invitation (or merely replay the link) a way to lock the invitee out of their own
        // account for fifteen minutes without ever guessing a character. A WRONG password still
        // counts, exactly as at /login; an absent one is not an attempt.
        //
        // It reveals nothing: the answer is the same whatever the stored password is, and preview
        // has already told this token holder that the address has an account.
        if (password == null || password.isBlank()) {
            throw new ForbiddenException("Enter your Huddle password to join this household.");
        }

        // 403, not 401. This route is permitAll but the browser attaches whatever token it holds,
        // and a 401 on a token-bearing request signs the caller out of a session that is perfectly
        // valid -- their own, in a household this invitation has nothing to do with. Same rule as
        // PasswordChangeService's wrong-current-password branch; see backend-core.md.
        return verifyCredentials(user.getEmail(), password, ipAddress,
                () -> new ForbiddenException("That password didn't match. Try again, or reset it."));
    }

    /** A brand-new address is SETTING a password, so there is nothing to prove it against. */
    private User createInvitedUser(String email, String password) {
        if (password == null || password.isBlank()) {
            throw new ForbiddenException("Choose a password to finish setting up your login.");
        }
        return userRepository.save(new User(email, passwordEncoder.encode(password)));
    }

    /**
     * Proves a password against an account, with the rate limiting and lockout that make doing so
     * safe. The ONLY place in the app that turns an email plus a password into a {@link User}.
     *
     * <p>⚠️ <b>The ordering is a DoS defence, not a style.</b> {@link #checkLoginAllowed} runs
     * before the lookup and before any BCrypt work, so a flood is refused without paying ~100ms of
     * CPU per attempt; the lockout check runs before the comparison for the same reason. Do not
     * reorder either.
     *
     * <p>⚠️ <b>{@code refusal} exists because the right status differs by route, and the wrong one
     * signs people out.</b> On {@code /login} a bad password is a 401 — the password IS the session
     * credential and there is no session to lose. On {@code /accept-invite} it is a SECOND
     * credential on a route the browser attaches an existing token to, where a 401 would make
     * {@code api/client.js} tear that session down. The refusal must be built identically for the
     * unknown-address and wrong-password branches, or the difference between them becomes a
     * user-enumeration oracle.
     */
    private User verifyCredentials(String email, String rawPassword, String ipAddress,
                                    Supplier<RuntimeException> refusal) {
        Instant now = clock.instant();

        // ⚠️ BEFORE the user lookup and before any BCrypt work. Keyed on the NORMALISED email --
        // keying on the raw string would give Nate@x.com and nate@x.com a budget each, which is a
        // bypass rather than a nicety.
        checkLoginAllowed(email, ipAddress);

        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            // Spend the same time as a real verification would, then fail identically. See
            // DUMMY_HASH -- returning early here is what made login a user-enumeration oracle.
            passwordEncoder.matches(rawPassword == null ? "" : rawPassword, DUMMY_HASH);
            throw refusal.get();
        }

        // Checked BEFORE the password comparison, so a locked account costs no BCrypt either.
        if (user.isLockedAt(now)) {
            log.warn("Sign-in refused for {} from ip {}: account locked until {}",
                    email, ipAddress, user.getLockedUntil());
            throw new LockedException("Too many failed attempts. Try again in a few minutes,"
                    + " or reset your password to get back in right away.");
        }

        if (rawPassword == null || !passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            user.recordFailedLogin(MAX_FAILED_LOGINS, now, LOCKOUT_DURATION);
            userRepository.save(user);
            if (user.getLockedUntil() != null) {
                log.warn("Locked account {} until {} after {} failed sign-ins (latest from ip {})",
                        email, user.getLockedUntil(), MAX_FAILED_LOGINS, ipAddress);
            }
            throw refusal.get();
        }

        user.clearLoginLockout();
        return user;
    }

    /**
     * Turns a proved identity into either a session or a household choice — the two shapes of
     * {@link AuthResponse}, and the single place that decides between them.
     *
     * <p>Shared by {@link #login} and {@link #acceptInvite} so the two can never drift on what
     * "signed in" means. Zero memberships is not a "shouldn't happen": it is what a revoked member
     * sees, and it must not be an enumeration oracle — they proved the password, so telling them
     * their access is gone reveals nothing they did not already know.
     *
     * <p>⚠️ Not an enumeration risk, and it is worth being precise about why: everything here is
     * about the caller's OWN memberships, revealed only after their own credential was accepted.
     * Nothing says anything about an address that failed, which is what {@code DUMMY_HASH} and the
     * uniform failure path exist to protect.
     *
     * <p>The one-household path returns byte-for-byte what it always has.
     */
    private AuthResponse sessionOrPicker(User user) {
        List<AccountMembership> memberships =
                membershipRepository.findByUser_IdOrderByCreatedAtAscIdAsc(user.getId());
        if (memberships.isEmpty()) {
            log.warn("Credential for {} was accepted but the user has no membership", user.getEmail());
            throw new UnauthorizedException("That login is no longer attached to a household.");
        }

        // Two or more households: the credential is proved but the account is not chosen, so there
        // is nothing to put in a token's accountId yet. Hand back the choices and a five-minute
        // proof, and let POST /api/auth/session mint the real thing.
        if (memberships.size() > 1) {
            log.info("Credential for {} resolved to {} households; returning a picker",
                    user.getEmail(), memberships.size());
            return AuthResponse.chooseHousehold(
                    UserDto.from(user),
                    memberships.stream().map(HouseholdChoiceDto::from).toList(),
                    jwtService.generateSelectionToken(user.getId(), user.getEmail(), user.getTokenVersion()));
        }

        return signedIn(user, memberships.get(0));
    }

    /** The signed-in response for one membership. Shared by {@link #sessionOrPicker} and
     * {@link #startSession}, which must describe a session identically however it was reached. */
    private AuthResponse signedIn(User user, AccountMembership membership) {
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

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(),
                user.getRole(), user.getTokenVersion());
        return AuthResponse.signedIn(token, UserDto.from(user),
                AccountDto.from(account, subscriptionService.planFor(account.getId())),
                MembershipDto.from(membership,
                        ownerNameForMember(account.getId(), membership.getAccountRole()),
                        subscriptionService.isPlus(account.getId())),
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
    public AuthResponse startSession(Long userId, int tokenVersion, Long accountId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer valid."));

        // ⚠️ THE CHECK EVERY OTHER ROUTE GETS FOR FREE, AND THIS ONE HAS TO MAKE ITSELF.
        //
        // JwtAuthenticationFilter refuses any token whose tv no longer matches the users row (via
        // AccountAccessService.resolve), which is what makes a password change actually revoke
        // every token that user holds. This route bypasses the filter by design -- a selection
        // token deliberately cannot authenticate through it -- and JwtService.parseToken checks
        // only the signature and the expiry. Without this line the route swapped a token every
        // other route already refused for a brand-new 30-day one, so "change your password because
        // you think you are compromised" did not sign the attacker out at all.
        //
        // 401 is exactly right and is NOT the trap backend-core.md warns about: what failed here IS
        // the token that made the request, not a second credential alongside it, so "your session
        // is over" is the honest reading and api/client.js's sign-out is the correct response.
        //
        // Polarity is absent-means-CURRENT, like the role and scp claims: a token minted before the
        // tv claim existed parses as 0 and matches a never-bumped row, so existing sessions keep
        // working. Never invert that -- it would sign out every user at deploy.
        if (user.getTokenVersion() != tokenVersion) {
            log.warn("Session refused for user {}: token version {} is stale (current {})",
                    userId, tokenVersion, user.getTokenVersion());
            throw new UnauthorizedException("That login is no longer valid.");
        }

        // Checked SECOND, and the order is deliberate: a stale token is 401 ("this credential is
        // over") while a household you are not in is 404 ("no such thing"), and answering 404 to a
        // revoked token would tell its holder the token still works and only the account id is
        // wrong. See the method comment for why this one is 404 rather than 403.
        AccountMembership membership = membershipRepository
                .findByAccount_IdAndUser_Id(accountId, userId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that household."));

        return signedIn(user, membership);
    }

    // Narrowest bucket first, matching ContactRateLimiter's ordering and for the same reason: a
    // single abuser should exhaust their own allowance before touching the shared one.
    // Narrowest bucket first, matching ContactRateLimiter's documented ordering and for the same
    // reason: the message a caller gets should name the narrowest thing they actually tripped, and
    // a wide bucket consumed on the way past a narrow refusal is budget spent on a request that
    // was never going to be served.
    private void checkLoginAllowed(String email, String ipAddress) {
        // ⚠️ CONSUMED FOR EVERY SUBMITTED ADDRESS, known or not. Gating this on the account
        // existing would make "which addresses eventually 429" a user-enumeration oracle --
        // precisely what DUMMY_HASH (below) and PasswordResetService's non-enumerating design
        // exist to close. That is why this sits here rather than after the lookup, where it would
        // read as more natural and be wrong.
        //
        // The refusal message is deliberately the SAME shape as the per-IP one and names no
        // account, so a 429 still reveals nothing about whether that address is registered.
        if (!loginRateLimiter.tryConsumePerEmail(email)) {
            log.warn("Login blocked by per-email rate limit (ip {})", ipAddress);
            throw new TooManyRequestsException(
                    "Too many sign-in attempts -- please try again later, or reset your password.");
        }
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
