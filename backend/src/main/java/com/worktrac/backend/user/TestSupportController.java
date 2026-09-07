package com.worktrac.backend.user;

import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.account.Account;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.membership.AccountMembership;
import com.worktrac.backend.membership.MembershipInvite;
import com.worktrac.backend.membership.MembershipInviteRepository;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.dto.EmailOutcomeResponse;
import com.worktrac.backend.user.dto.PendingCodeResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

// Exists only so Playwright e2e tests (which can't read a real inbox) can retrieve a
// registration's verification code. Never present at all outside local/lower -- @Profile means
// Spring doesn't register this bean/route in production regardless of any request, and the
// shared-secret header is a second, independent gate on top of that: a misconfigured
// SPRING_PROFILES_ACTIVE alone can't expose another user's code. Any failure (wrong profile,
// missing/wrong header, no pending code for the email) returns 404 rather than 401/403, so an
// unauthenticated caller can't even confirm the route exists.
@RestController
@Profile({"local", "lower"})
public class TestSupportController {

    private static final Set<RegistrationEventType> VERIFICATION_EMAIL_OUTCOMES =
            Set.of(RegistrationEventType.VERIFICATION_EMAIL_SENT, RegistrationEventType.VERIFICATION_EMAIL_FAILED);

    private final TestCodeCache testCodeCache;
    private final EmailProperties emailProperties;
    private final RegistrationEventRepository registrationEventRepository;
    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionService subscriptionService;
    private final AccountMembershipRepository membershipRepository;
    private final AccountAccessService accountAccessService;
    private final PersonRepository personRepository;
    private final PasswordEncoder passwordEncoder;
    private final MembershipInviteRepository inviteRepository;
    private final JdbcTemplate jdbcTemplate;

    public TestSupportController(TestCodeCache testCodeCache, EmailProperties emailProperties,
                                  AccountMembershipRepository membershipRepository,
                                  AccountAccessService accountAccessService,
                                  PersonRepository personRepository,
                                  PasswordEncoder passwordEncoder,
                                  MembershipInviteRepository inviteRepository,
                                  JdbcTemplate jdbcTemplate,
                                  RegistrationEventRepository registrationEventRepository,
                                  UserRepository userRepository,
                                  SubscriptionRepository subscriptionRepository,
                                  SubscriptionService subscriptionService) {
        this.testCodeCache = testCodeCache;
        this.emailProperties = emailProperties;
        this.registrationEventRepository = registrationEventRepository;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.subscriptionService = subscriptionService;
        this.membershipRepository = membershipRepository;
        this.accountAccessService = accountAccessService;
        this.personRepository = personRepository;
        this.passwordEncoder = passwordEncoder;
        this.inviteRepository = inviteRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/api/auth/test/pending-code")
    public ResponseEntity<PendingCodeResponse> pendingCode(
            @RequestParam String email,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        String code = testCodeCache.get(email.trim().toLowerCase());
        if (code == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(new PendingCodeResponse(code));
    }

    // Backs the live-email-canary e2e spec -- the one spec whose recipient deliberately doesn't
    // match EmailService's e2e-noop pattern, so it triggers a real Azure Communication Services
    // send. Registering + confirming successfully doesn't prove that send actually worked (the
    // verification code is written to TestCodeCache synchronously, independent of whether the
    // async email dispatch that follows succeeds, fails, or gets no-op'd) -- this endpoint lets
    // that spec check the real outcome recorded in registration_events instead.
    @GetMapping("/api/auth/test/email-outcome")
    public ResponseEntity<EmailOutcomeResponse> emailOutcome(
            @RequestParam String email,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<RegistrationEvent> event = registrationEventRepository
                .findFirstByEmailAndEventTypeInOrderByCreatedAtDesc(email.trim().toLowerCase(),
                        VERIFICATION_EMAIL_OUTCOMES);
        if (event.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        RegistrationEvent latest = event.get();
        String status = latest.getEventType() == RegistrationEventType.VERIFICATION_EMAIL_SENT ? "SENT" : "FAILED";
        return ResponseEntity.ok(new EmailOutcomeResponse(status, latest.getMessageId(), latest.getDetail()));
    }

    // Sets a household's plan directly, so the e2e suite can exercise both sides of every gate
    // without Stripe existing at all. The same escape hatch EmailProperties.e2eNoopRecipientPattern
    // provides for Azure Communication Services, and the reason the Playwright suite needs no
    // Stripe credentials in any environment.
    //
    // Carries the same two independent gates as everything else here -- @Profile({"local","lower"})
    // means the bean does not exist in production, and the shared-secret header is checked on top
    // of that. Every failure is a 404, so an unauthenticated caller cannot confirm the route exists.
    //
    // It writes `comped` rather than a fake ACTIVE subscription: a comped household is Pro through
    // the same single derivation as a paying one (SubscriptionService.isPro), so a test that passes
    // here is exercising the real entitlement path, not a special case built for tests.
    @PostMapping("/api/auth/test/billing-plan")
    public ResponseEntity<Void> setBillingPlan(
            @RequestParam String email,
            @RequestParam String plan,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<User> user = userRepository.findByEmail(email.trim().toLowerCase());
        if (user.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        // The household this login OWNS. Test support drives billing state for the account under
        // test, and a member's household is not theirs to change.
        List<AccountMembership> owned = membershipRepository.findByUser_IdOrderByCreatedAtAscIdAsc(user.get().getId())
                .stream()
                .filter(m -> m.getAccountRole() == AccountRole.OWNER)
                .toList();
        if (owned.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        Subscription subscription = subscriptionService.getOrCreate(owned.get(0).getAccount());
        boolean pro = "PRO".equalsIgnoreCase(plan.trim());
        subscription.setComped(pro);
        subscription.setPlan(pro ? BillingPlan.PRO : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
        return ResponseEntity.noContent().build();
    }

    private boolean keyMatches(String suppliedKey) {
        String expectedKey = emailProperties.getTestSupportKey();
        if (expectedKey == null || expectedKey.isBlank() || suppliedKey == null) {
            return false;
        }
        // Constant-time comparison -- this guards a real (if narrow) secret.
        return MessageDigest.isEqual(
                expectedKey.getBytes(StandardCharsets.UTF_8),
                suppliedKey.getBytes(StandardCharsets.UTF_8));
    }

    // Mints a MEMBER login for an existing person in an existing household, so the e2e suite can
    // exercise member permissions without the invite flow existing yet (phase 7 builds that).
    //
    // Same two independent gates as everything else here: @Profile({"local","lower"}) means the
    // bean does not exist in production at all, and the shared-secret header is checked on top.
    // Every failure is a 404, so an unauthenticated caller cannot confirm the route exists.
    //
    // It creates a REAL user + a REAL membership, so a test that passes here is exercising the
    // same AccountAccessService resolution and the same guards a genuine member will hit -- not a
    // special case built for tests.
    @PostMapping("/api/auth/test/member")
    public ResponseEntity<Void> createMemberLogin(
            @RequestParam String ownerEmail,
            @RequestParam String personName,
            @RequestParam String memberEmail,
            @RequestParam String password,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<Account> account = ownedAccount(ownerEmail);
        if (account.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        Optional<Person> person = personRepository
                .findByAccount_IdOrderByCreatedAtAsc(account.get().getId()).stream()
                .filter(p -> p.getName().equalsIgnoreCase(personName.trim()))
                .findFirst();
        if (person.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        // A person can hold at most one login (UX_account_memberships_account_person). Without
        // this check the insert violates that index and GlobalExceptionHandler answers 503 -- an
        // honest response to a DataAccessException, but it tells a test author nothing. The usual
        // cause is naming the OWNER's own person, which already has a membership.
        if (membershipRepository.findByAccount_IdAndPerson_Id(account.get().getId(), person.get().getId()).isPresent()) {
            return ResponseEntity.status(409).build();
        }

        String normalised = memberEmail.trim().toLowerCase();
        User member = userRepository.findByEmail(normalised)
                .orElseGet(() -> userRepository.save(new User(normalised, passwordEncoder.encode(password))));
        if (membershipRepository.findByAccount_IdAndUser_Id(account.get().getId(), member.getId()).isEmpty()) {
            membershipRepository.save(new AccountMembership(account.get(), member, person.get(), AccountRole.MEMBER));
        }
        // Without this the new membership is invisible for up to the cache's 60s TTL, which would
        // make every member test flaky in exactly the way that wastes an afternoon.
        accountAccessService.invalidateAccount(account.get().getId());
        return ResponseEntity.noContent().build();
    }

    // Flips accounts.members_see_everyone for one household.
    //
    // ⚠️ A DIRECT UPDATE, on purpose. Account has NO setter for this column and no endpoint sets
    // it -- that absence is what forces Pro/Family to "everyone sees everyone" by construction
    // rather than by a check somebody could flip (see V66). Adding a setter for the benefit of
    // tests would hand production code the very lever the design removes, so the mutation lives
    // here instead, inside a controller whose bean does not exist outside local/lower.
    //
    // The Team tier is what adds a real setter, service method and toggle.
    @PostMapping("/api/auth/test/member-visibility")
    public ResponseEntity<Void> setMemberVisibility(
            @RequestParam String ownerEmail,
            @RequestParam boolean membersSeeEveryone,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<Account> account = ownedAccount(ownerEmail);
        if (account.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        jdbcTemplate.update("UPDATE accounts SET members_see_everyone = ? WHERE id = ?",
                membersSeeEveryone ? 1 : 0, account.get().getId());
        accountAccessService.invalidateAccount(account.get().getId());
        return ResponseEntity.noContent().build();
    }

    /**
     * The outstanding invite for a household, with a token that will actually work.
     *
     * <p>⚠️ It does NOT return the real emailed token — nothing can. The raw value exists only on
     * the send event, and the row holds a BCrypt hash with a per-row salt, so it cannot be read
     * back or recomputed. This PLANTS a known token (replacing the hash) and returns it, which is
     * the same trade {@code /pending-code} makes for registration codes.
     *
     * <p>What that costs is honest to state: the emailed link itself is not exercised. What it
     * keeps is everything else — a real invite row, a real {@code matches()} check against a real
     * BCrypt hash, a real expiry and attempt ceiling, and a real membership at the end.
     *
     * <p>Profile-gated and key-gated like every route here, so it exists in local/lower only.
     */
    @GetMapping("/api/auth/test/pending-invite")
    public ResponseEntity<Map<String, Object>> pendingInvite(
            @RequestParam String ownerEmail,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<Account> account = ownedAccount(ownerEmail);
        if (account.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        List<MembershipInvite> pending = inviteRepository.findPendingForAccount(account.get().getId());
        if (pending.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        // The newest, so a resend in the same test reads as the one just sent.
        MembershipInvite invite = pending.stream()
                .max(Comparator.comparing(MembershipInvite::getId))
                .orElseThrow();

        String token = "e2e-invite-token-" + invite.getId();
        jdbcTemplate.update("UPDATE membership_invites SET token_hash = ? WHERE id = ?",
                passwordEncoder.encode(token), invite.getId());

        return ResponseEntity.ok(Map.of("inviteId", invite.getId(), "token", token));
    }

    // The household a login OWNS. Every route here drives state for the account under test, and a
    // member's household is not theirs to change.
    private Optional<Account> ownedAccount(String email) {
        return userRepository.findByEmail(email.trim().toLowerCase())
                .flatMap(user -> membershipRepository.findByUser_IdOrderByCreatedAtAscIdAsc(user.getId()).stream()
                        .filter(m -> m.getAccountRole() == AccountRole.OWNER)
                        .findFirst())
                .map(AccountMembership::getAccount);
    }

}
