package com.worktrac.backend.membership;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
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
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Invites a person in a household to get their own login, and accepts those invitations.
 *
 * <p>── ⚠️ THE INVARIANT THAT SHAPES EVERYTHING HERE ─────────────────────────────────────────────
 *
 * <p><b>Both invite paths require acceptance, and the two must be INDISTINGUISHABLE to the owner.</b>
 * Whether the invited address already has a Huddle account or not, the owner sees exactly one
 * outcome — "invited, pending" — and the membership is created only when the invitee accepts.
 *
 * <p>The obvious shortcut is to notice the address already exists and attach the membership
 * immediately. That would be a <b>user-enumeration oracle</b>: anyone with a household could type
 * an address and learn from the result whether that person has a Huddle account. It leaks precisely
 * what {@code PasswordResetService}'s non-enumerating design and {@code AuthService}'s
 * {@code DUMMY_HASH} exist to hide, and it hands it out through a route that needs no password at
 * all.
 *
 * <p>It also matters for a much more ordinary reason: a mistyped invite would otherwise silently
 * give a stranger read access to the household's entire training history. Requiring acceptance
 * means a wrong address gets an email it will ignore, not a seat at the table.
 *
 * <p>The <b>email</b> differs between the two cases — "set a password" vs. "sign in with the one
 * you have" — because the recipient legitimately needs different instructions. Nothing the OWNER
 * can observe differs.
 */
@Service
public class MembershipInviteService {

    private static final Logger log = LoggerFactory.getLogger(MembershipInviteService.class);

    /** Long enough that guessing is hopeless; the id in the link is the lookup, this is the proof. */
    private static final int TOKEN_BYTES = 32;
    private static final Duration LIFETIME = Duration.ofDays(7);

    // Mirrors RegistrationService's ceilings, and for the same reasons.
    private static final int MAX_ATTEMPTS = 5;
    private static final Duration RESEND_COOLDOWN = Duration.ofSeconds(60);
    private static final int MAX_RESENDS = 5;

    private final MembershipInviteRepository inviteRepository;
    private final AccountMembershipRepository membershipRepository;
    private final AccountRepository accountRepository;
    private final PersonRepository personRepository;
    private final PersonService personService;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AccountAccessService accountAccessService;
    private final SubscriptionService subscriptionService;
    private final ApplicationEventPublisher events;
    private final RegistrationAuditService auditService;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    public MembershipInviteService(MembershipInviteRepository inviteRepository,
                                    AccountMembershipRepository membershipRepository,
                                    AccountRepository accountRepository,
                                    PersonRepository personRepository,
                                    PersonService personService,
                                    UserRepository userRepository,
                                    PasswordEncoder passwordEncoder,
                                    AccountAccessService accountAccessService,
                                    SubscriptionService subscriptionService,
                                    ApplicationEventPublisher events,
                                    RegistrationAuditService auditService,
                                    Clock clock) {
        this.inviteRepository = inviteRepository;
        this.membershipRepository = membershipRepository;
        this.accountRepository = accountRepository;
        this.personRepository = personRepository;
        this.personService = personService;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.accountAccessService = accountAccessService;
        this.subscriptionService = subscriptionService;
        this.events = events;
        this.auditService = auditService;
        this.clock = clock;
    }

    /**
     * The owner's Logins list: every person in the household, and where their login stands.
     *
     * <p>Built from THREE sources deliberately — the visible people, the memberships, and the
     * outstanding invites — rather than a join, because a person with neither is a legitimate row
     * ({@code NONE}) and the most common one. A join would drop exactly the people the owner most
     * needs to see, which are the ones with no login yet.
     *
     * <p>Goes through {@code personService.list} so the roster is the same filtered set every other
     * screen sees. In practice this endpoint is owner-only, so the filter is a no-op — but reading
     * the repository directly here would be a second source of "who exists", and those drift.
     */
    @Transactional(readOnly = true)
    public List<PersonLoginDto> logins(AccountAccess access) {
        Long accountId = access.accountId();

        Map<Long, String> emailByPerson = new HashMap<>();
        Map<Long, String> statusByPerson = new HashMap<>();
        Map<Long, Instant> lockedUntilByPerson = new HashMap<>();

        for (AccountMembership membership : membershipRepository.findByAccount_Id(accountId)) {
            if (membership.getPerson() == null) {
                continue;
            }
            statusByPerson.put(membership.getPerson().getId(), PersonLoginDto.ACTIVE);
            emailByPerson.put(membership.getPerson().getId(), membership.getUser().getEmail());
            // Only while it is STILL in force -- a lapsed lockout is not something the owner needs
            // to see, and showing one would have them "fixing" a login that already works.
            if (membership.getUser().isLockedAt(clock.instant())) {
                lockedUntilByPerson.put(membership.getPerson().getId(), membership.getUser().getLockedUntil());
            }
        }

        Instant now = clock.instant();
        for (MembershipInvite invite : inviteRepository.findPendingForAccount(accountId)) {
            Long personId = invite.getPerson().getId();
            // An ACTIVE membership wins over a pending invite for the same person. That pair should
            // not exist -- accept marks the invite -- but a race or a hand-edited row must not make
            // a working login read as "still waiting".
            if (statusByPerson.containsKey(personId)) {
                continue;
            }
            // An expired invitation is NOT "invited". Showing it as pending would leave the owner
            // waiting on something that can never be accepted; NONE is the honest state, and the
            // action it offers -- invite again -- is the one that works.
            if (invite.getExpiresAt().isBefore(now)) {
                continue;
            }
            statusByPerson.put(personId, PersonLoginDto.INVITED);
            emailByPerson.put(personId, invite.getEmail());
        }

        return personService.list(access).stream()
                .map(person -> new PersonLoginDto(
                        person.id(),
                        person.name(),
                        statusByPerson.getOrDefault(person.id(), PersonLoginDto.NONE),
                        emailByPerson.get(person.id()),
                        // Objects.equals, not ==: both sides are boxed Longs, and selfPersonId is
                        // legitimately null for a membership not bound to a person.
                        Objects.equals(person.id(), access.selfPersonId()),
                        lockedUntilByPerson.get(person.id())))
                .toList();
    }

    /**
     * The household owner's name, for the invite email's greeting and its transparency sentence.
     *
     * <p>Reuses the query written for the rename refusal rather than a second lookup — one place
     * decides what "the owner" means when the schema permits more than one OWNER membership.
     *
     * <p>Falls back to a generic phrase rather than an empty string: the email reads "{owner} set
     * up a login for you", and a household with no owner membership must still produce a sentence.
     */
    @Transactional(readOnly = true)
    public String ownerNameFor(Long accountId) {
        return membershipRepository.findOwnerPersonNames(accountId, AccountRole.OWNER).stream()
                .filter(name -> name != null && !name.isBlank())
                .findFirst()
                .orElse("The account owner");
    }

    /**
     * The owner's EMAIL, for the one notice that goes to them.
     *
     * <p>Separate from {@link #ownerNameFor} deliberately: the name is chrome a member sees, the
     * address is a send target and never leaves the server. Nothing hands a member the owner's
     * email — see MembershipDto's comment.
     */
    @Transactional(readOnly = true)
    public String ownerEmailFor(Long accountId) {
        return membershipRepository.findOwners(accountId).stream()
                .map(m -> m.getUser().getEmail())
                .findFirst()
                .orElse(null);
    }

    /** The household's own name, for the notices that have to say which household. */
    @Transactional(readOnly = true)
    public String householdNameFor(Long accountId) {
        return accountRepository.findById(accountId).map(Account::getName).orElse("your household");
    }

    /** What the caller needs to send the email. The raw token exists only in this object. */
    public record IssuedInvite(MembershipInvite invite, String rawToken, boolean recipientHasAccount) {
    }

    /**
     * Issues (or re-issues) an invitation for one person in this household.
     *
     * <p>Returns the same shape whatever the state of the invited address — see the class comment.
     * The {@code recipientHasAccount} flag exists ONLY so the caller can choose which email body to
     * send; it must never reach a response the owner can read.
     */
    @Transactional
    public IssuedInvite invite(AccountAccess access, Long personId, String rawEmail) {
        String email = normalise(rawEmail);
        Instant now = clock.instant();

        // requireVisiblePerson, not a bare lookup: a person outside this household must 404 rather
        // than confirm they exist somewhere.
        Person person = personService.requireVisiblePerson(personId, access);

        // ⚠️ Refused on Free, and this is about not making a promise we cannot keep. Without it an
        // owner on Free sends an invitation, the invitee chooses a password, accepts, and lands
        // immediately on "your login is paused" -- an onboarding flow whose successful path is a
        // dead end. The refusal reaches the owner verbatim (LoginsSection opts into
        // showServerMessage), so they are told the actual reason rather than "that didn't save".
        //
        // A CONFLICT rather than a FORBIDDEN: they hold MANAGE_LOGINS perfectly well, and will be
        // able to do exactly this the moment the household is Pro. 403 would say "not you", which
        // is the wrong diagnosis and points at the wrong fix.
        if (!subscriptionService.isPro(access.accountId())) {
            throw new ConflictException(
                    "Personal logins are part of Huddle Pro. Upgrade and you can invite "
                            + person.getName() + " straight away.");
        }

        // One login per person, enforced by UX_account_memberships_account_person. Checked here so
        // it reads as a conflict rather than surfacing later as a 503 from a unique-index violation
        // -- the exact failure the test-support route hit in phase 4.
        if (membershipRepository.findByAccount_IdAndPerson_Id(access.accountId(), personId).isPresent()) {
            throw new ConflictException(person.getName() + " already has a login.");
        }

        Optional<MembershipInvite> existing = inviteRepository.findPendingFor(access.accountId(), personId);
        IssuedInvite issued;
        if (existing.isPresent()) {
            issued = resend(existing.get(), email, now);
        } else {
            String rawToken = generateToken();
            Account account = accountRepository.getReferenceById(access.accountId());
            MembershipInvite invite = inviteRepository.save(new MembershipInvite(
                    account, person, email, passwordEncoder.encode(rawToken),
                    now.plus(LIFETIME), now, access.userId()));

            log.info("Invite issued for person {} in account {} by user {}",
                    personId, access.accountId(), access.userId());
            issued = new IssuedInvite(invite, rawToken, userRepository.findByEmail(email).isPresent());
        }

        // Both paths announce, and they announce from HERE -- see announce()'s comment for why the
        // controller cannot.
        announce(issued, access.accountId());
        return issued;
    }

    /**
     * Records the watchdog's start marker and publishes the event that sends the email.
     *
     * <p>⚠️ <b>THIS MUST BE CALLED FROM INSIDE THE TRANSACTION, and it is not a style choice.</b>
     * The listener is {@code @TransactionalEventListener(AFTER_COMMIT)}, which with the default
     * {@code fallbackExecution = false} <b>silently discards</b> any event published when no
     * transaction is active. Publishing from the controller — after this {@code @Transactional}
     * method has already returned and committed — therefore sends no email at all, with no
     * exception, no log line and a 200 response. It shipped that way and nothing went red: every
     * other test in {@code MembershipInviteTest} reads the invite row straight from the database,
     * and so does the e2e via {@code /api/auth/test/pending-invite}.
     *
     * <p>{@code MembershipInviteTest#theInvitationEmailIsActuallySent} is the pin. Every other
     * publisher in this codebase ({@code RegistrationService}, {@code PasswordResetService},
     * {@code ContactMessageService}) already publishes from inside its transactional service
     * method; this is that same shape, not a new one.
     */
    private void announce(IssuedInvite issued, Long accountId) {
        MembershipInvite invite = issued.invite();

        // The watchdog's half of the pair: without a STARTED marker, an invite whose dispatch never
        // ran leaves no trace at all -- "didn't run" and "ran fine" would look identical from
        // outside, which is the one thing the async contract forbids. REQUIRES_NEW, so the marker
        // is durable whether or not the invite itself goes on to commit.
        auditService.record(invite.getEmail(), RegistrationEventType.MEMBER_INVITE_STARTED, null);

        events.publishEvent(new MembershipInviteIssuedEvent(
                invite.getEmail(),
                invite.getPerson().getName(),
                invite.getAccount().getName(),
                ownerNameFor(accountId),
                issued.rawToken(),
                invite.getId(),
                issued.recipientHasAccount()));
    }

    /**
     * Re-sends an outstanding invitation, replacing its secret.
     *
     * <p>A resend mints a NEW token, so any link already sitting in an inbox stops working. That is
     * the point: the usual reason to resend is that the first one went astray, and leaving both
     * live doubles the window in which a mis-sent link is usable.
     */
    private IssuedInvite resend(MembershipInvite invite, String email, Instant now) {
        if (invite.getLastSentAt().plus(RESEND_COOLDOWN).isAfter(now)) {
            throw new TooManyRequestsException("That invite was just sent. Try again in a minute.");
        }
        if (invite.getResendCount() >= MAX_RESENDS) {
            throw new TooManyRequestsException("That invite has been sent too many times. Remove it and start again.");
        }
        String rawToken = generateToken();
        invite.resent(passwordEncoder.encode(rawToken), now.plus(LIFETIME), now);
        log.info("Invite {} resent (count {})", invite.getId(), invite.getResendCount());
        return new IssuedInvite(invite, rawToken, userRepository.findByEmail(email).isPresent());
    }

    /** What the /join screen needs to know before it can ask the right question. */
    public record InvitePreview(String householdName, String personName, String email,
                                 boolean recipientHasAccount) {
    }

    /**
     * Answers "what does this invitation want from me?" for the holder of a valid link.
     *
     * <p>The screen behind an invite link cannot be written without this. An address that already
     * has a Huddle account must be asked to SIGN IN; one that does not must be asked to CHOOSE a
     * password. The page previously offered a password field to both and told the reader to leave
     * it blank if the first case applied — asking somebody to understand an implementation detail
     * about themselves, and directly contradicting the invitation email, which tells that same
     * reader to sign in with the password they already have.
     *
     * <p>⚠️ <b>WHY THIS IS NOT THE USER-ENUMERATION ORACLE THE CLASS COMMENT FORBIDS.</b> The
     * oracle that matters is the <b>OWNER's</b>: anyone with a household typing an address and
     * learning whether that person uses Huddle. Nothing here is reachable by an owner. The only
     * caller is the holder of a valid {@code (inviteId, token)} pair, and that pair exists in
     * exactly one place — the invited mailbox. The raw token goes straight from
     * {@link #generateToken()} onto {@code MembershipInviteIssuedEvent} and into the email; the
     * owner's own response is a hardcoded {@code INVITED} row that never carries it.
     *
     * <p>And the holder of that pair could already learn this, before this method existed, by
     * POSTing accept with a blank password: a known address signed straight in, an unknown one
     * answered "Choose a password to finish setting up your login." Reading your own invitation
     * out of your own inbox is not enumeration. What must stay untouched — and does — is that
     * {@code PersonLoginDto} keeps three states, that the invite response is identical either way,
     * and that the email body is the only thing that differs.
     *
     * <p>Runs the SAME gauntlet as accepting, via {@link #requireValidInvite}, so a bad token costs
     * an attempt here exactly as it does there and cannot be used as a free oracle for guessing.
     */
    @Transactional(noRollbackFor = ForbiddenException.class)
    public InvitePreview preview(Long inviteId, String rawToken) {
        MembershipInvite invite = requireValidInvite(inviteId, rawToken);
        return new InvitePreview(
                invite.getAccount().getName(),
                invite.getPerson().getName(),
                invite.getEmail(),
                userRepository.findByEmail(invite.getEmail()).isPresent());
    }

    /**
     * Every check that stands between a link and the household behind it, in one place.
     *
     * <p>Shared by {@link #preview} and by the accept path in {@code AuthService}, so the two can
     * never drift into disagreeing about which links are live.
     *
     * <p>⚠️ <b>{@code noRollbackFor} is load-bearing and was missing.</b> The bad-token branch
     * increments {@code attemptCount} and then throws to report the failure, and Spring's default
     * rollback-on-RuntimeException discarded that increment every single time — so the counter
     * never advanced past zero in the database and the {@link #MAX_ATTEMPTS} ceiling had never
     * once fired in production. {@code RegistrationService.confirmEmail} and
     * {@code PasswordResetService.confirmReset} both carry this annotation with the same comment;
     * this method was the one of the three that did not.
     * {@code MembershipInviteTest#fiveWrongTokensLockTheInvitationOut} is the pin, and it fails
     * (counter 0, not 5) with the annotation removed.
     *
     * <p>The ceiling is also what bounds the CPU an anonymous caller can spend here: it is checked
     * BEFORE the BCrypt comparison, so a locked-out invitation costs a lookup rather than ~100ms
     * of hashing.
     */
    @Transactional(noRollbackFor = ForbiddenException.class)
    public MembershipInvite requireValidInvite(Long inviteId, String rawToken) {
        Instant now = clock.instant();

        // A wrong id and a wrong token answer identically: an invitation is a bearer credential, and
        // "that invite exists but your token is wrong" is information the holder of a bad link has
        // not earned.
        MembershipInvite invite = inviteRepository.findById(inviteId)
                .orElseThrow(MembershipInviteService::rejected);

        if (invite.isAccepted() || invite.getExpiresAt().isBefore(now)) {
            throw rejected();
        }
        if (invite.getAttemptCount() >= MAX_ATTEMPTS) {
            log.warn("Invite {} refused: locked out after {} bad tokens", invite.getId(), MAX_ATTEMPTS);
            throw rejected();
        }
        if (!passwordEncoder.matches(rawToken, invite.getTokenHash())) {
            invite.recordFailedAttempt();
            log.warn("Invite {} refused: bad token (attempt {} of {})",
                    invite.getId(), invite.getAttemptCount(), MAX_ATTEMPTS);
            throw rejected();
        }
        return invite;
    }

    /**
     * Turns a validated invitation into a real membership, for a user whose identity is already
     * proved.
     *
     * <p>⚠️ <b>THIS METHOD GRANTS ACCESS AND PROVES NOTHING.</b> Both halves of the proof happen
     * before it is called — {@link #requireValidInvite} for the link, and {@code AuthService} for
     * the person — and that split is deliberate. This used to be one method that verified the
     * token and then, for an address that already had an account, attached the membership and
     * handed back a full 30-day session <b>with no credential check at all</b>: whoever held the
     * link could sign in as that person and, via {@code POST /api/auth/session}, reach every other
     * household they belonged to. An invitation is a request to join a household, not a magic link
     * into somebody's whole Huddle identity, and a household owner must not be able to cause one
     * to be mailed to any address they can type. See {@code AuthService#acceptInvite}.
     *
     * <p>⚠️ <b>THE RACE THIS MUST SURVIVE.</b> An invited address can register its OWN household
     * between the invite being sent and being accepted. By accept time the user exists, so creating
     * one would collide on the unique email index and fail the whole operation — stranding an
     * invitation that is perfectly valid. The caller therefore always looks the user up first and
     * creates one only if it is genuinely absent, and never touches an existing user's password.
     * Anything else would let an invitation silently change somebody's credentials, which is the
     * one thing the owner must never be able to do.
     */
    @Transactional
    public AccountMembership attach(MembershipInvite invite, User user) {
        Instant now = clock.instant();
        Long accountId = invite.getAccount().getId();

        // Between issue and accept, somebody may have given this person a login by another route.
        // The invitation is simply spent rather than an error: the outcome it asked for is already
        // true.
        Optional<AccountMembership> already = membershipRepository
                .findByAccount_IdAndPerson_Id(accountId, invite.getPerson().getId());
        if (already.isPresent()) {
            invite.accept(now);
            return already.get();
        }

        AccountMembership membership = membershipRepository.save(new AccountMembership(
                invite.getAccount(), user, invite.getPerson(), AccountRole.MEMBER));
        invite.accept(now);
        log.info("Invite {} accepted; membership {} created for account {}",
                invite.getId(), membership.getId(), accountId);

        // ⚠️ Matters now that an ALREADY SIGNED-IN person can accept. AccountAccessService caches
        // negative answers for 60s, so a user whose device had touched this household in the last
        // minute -- a stale tab, a shared iPad, an eager prefetch -- would otherwise be refused for
        // up to a minute inside a household they had just joined. Same axis as revoke's call: per
        // (user, account), never invalidateUser, which would reach their other households too.
        accountAccessService.invalidate(user.getId(), accountId);

        // Both notices ride one event -- see MembershipAcceptedEvent for why the OWNER's is a
        // security control rather than a courtesy. Published here rather than from AuthController
        // for the reason announce() spells out: an AFTER_COMMIT listener drops anything published
        // with no transaction running.
        //
        // NOT published on the already-present branch above: no membership was created, so there is
        // nothing to tell the owner about, and a second notice for a login they already know about
        // would be the false alarm that teaches them to ignore the real one.
        events.publishEvent(new MembershipAcceptedEvent(
                user.getEmail(),
                ownerEmailFor(accountId),
                invite.getPerson().getName(),
                invite.getAccount().getName(),
                ownerNameFor(accountId)));

        return membership;
    }

    /**
     * Clears a member's login lockout, so they can try again immediately.
     *
     * <p>The fourth of the owner's four levers — invite, resend, revoke, unlock — and the only one
     * that is purely an act of help. <b>It grants nothing.</b> A lockout is a throttle on guessing,
     * not a credential, so clearing it cannot let the owner in as that member and cannot reveal
     * anything about their password. That is what makes it safe to give an owner, when setting a
     * password is not.
     *
     * <p>The member always had a self-service route (wait fifteen minutes, or reset their own
     * password), so this exists because the OWNER is the support desk: a teenager locked out
     * mid-workout asks the person standing next to them, not their inbox.
     *
     * <p>Idempotent and quiet: unlocking somebody who is not locked is a no-op, because the owner's
     * intent ("let them try again") is already true and a 404 would only invite a retry. Same
     * reasoning as revoke's 204.
     */
    @Transactional
    public void clearLockout(AccountAccess access, Long personId) {
        personService.requireVisiblePerson(personId, access);

        membershipRepository.findByAccount_IdAndPerson_Id(access.accountId(), personId)
                .map(AccountMembership::getUser)
                .ifPresent(user -> {
                    if (user.getLockedUntil() == null) {
                        return;
                    }
                    user.clearLoginLockout();
                    userRepository.save(user);
                    log.info("Login lockout cleared for person {} in account {} by user {}",
                            personId, access.accountId(), access.userId());
                });
    }

    /**
     * Removes a login from this household, or withdraws an invitation that was never accepted.
     *
     * <p>Returns the email that lost access, so the caller can tell them — or empty when there was
     * nothing to revoke, which is not an error: the owner's intent ("this person should not have a
     * login") is already true.
     *
     * <p>⚠️ <b>THE PERSON AND EVERY SET THEY LOGGED STAY.</b> This deletes a membership, never a
     * person and never training data. Sam losing their login must leave Sam, Sam's history and
     * Sam's PRs exactly where they were, reachable by the owner as they were before the login
     * existed. Anything else turns an access decision into data loss.
     *
     * <p>⚠️ <b>The user row survives too, when it is a way into another household.</b> A credential
     * can belong to several households now, so revoking here must never sign somebody out of
     * somewhere else — the same rule {@code AccountDeletionService} follows. A user left with zero
     * memberships anywhere is NOT deleted either: they may hold a pending invitation elsewhere, and
     * their own password-reset flow still has to work.
     *
     * <p><b>What this cannot do is reach a device that is offline.</b> A revoked member holding
     * queued writes keeps them until they reconnect, at which point their token resolves to no
     * membership and the session tears down with those writes undeliverable. There is no
     * server-side fix — see {@code offline-internals.md} — so the confirmation warns the owner
     * rather than pretending otherwise.
     */
    @Transactional
    public Optional<String> revoke(AccountAccess access, Long personId) {
        Long accountId = access.accountId();
        // Through the guard so a person outside this household 404s rather than confirming they
        // exist somewhere.
        personService.requireVisiblePerson(personId, access);

        Optional<String> revokedEmail = Optional.empty();
        // Read BEFORE anything is deleted: afterwards a removed login and a withdrawn invitation
        // look identical, and the notice has to say which. "Your login was removed" and "your
        // invitation was withdrawn" mean different things to the person receiving them -- only the
        // first implies queued offline work that may now never land.
        boolean hadMembership = false;

        Optional<AccountMembership> membership =
                membershipRepository.findByAccount_IdAndPerson_Id(accountId, personId);
        if (membership.isPresent()) {
            // ⚠️ An owner must not be able to remove their own way in. Nothing else in the app can
            // put it back, and a household with no owner has nobody who can invite one.
            if (membership.get().getAccountRole() == AccountRole.OWNER) {
                throw new ConflictException("You can't remove your own login. Delete the household instead.");
            }
            revokedEmail = Optional.of(membership.get().getUser().getEmail());
            hadMembership = true;
            membershipRepository.delete(membership.get());
            // Immediately on this replica, and within the cache TTL everywhere else. token_version
            // is deliberately NOT bumped: that is per-USER, so bumping it would sign them out of
            // every other household too.
            accountAccessService.invalidate(membership.get().getUser().getId(), accountId);
            log.info("Membership revoked for person {} in account {}", personId, accountId);
        }

        // A pending invitation is revoked by the same action, and the owner should not have to know
        // which state they were in to undo it.
        Optional<MembershipInvite> pending = inviteRepository.findPendingFor(accountId, personId);
        if (pending.isPresent()) {
            if (revokedEmail.isEmpty()) {
                revokedEmail = Optional.of(pending.get().getEmail());
            }
            inviteRepository.delete(pending.get());
            log.info("Pending invite withdrawn for person {} in account {}", personId, accountId);
        }

        // Empty means there was nothing to revoke, which is not an error and not worth an email.
        // Inside the transaction, per announce()'s comment.
        boolean wasOnlyAnInvitation = !hadMembership;
        revokedEmail.ifPresent(email -> events.publishEvent(new MembershipRevokedEvent(
                email, householdNameFor(accountId), ownerNameFor(accountId), wasOnlyAnInvitation)));

        return revokedEmail;
    }

    /**
     * One refusal for every way an invitation can fail to authorize.
     *
     * <p>Wrong id, wrong token, expired, already accepted, locked out — all the same status with
     * the same sentence. Distinguishing them tells whoever holds a bad link which part to keep
     * trying, and none of those distinctions helps a legitimate recipient, who can simply ask for
     * another.
     *
     * <p>⚠️ <b>403, and it must never go back to being a 401.</b> Both invite routes are
     * {@code permitAll}, but the browser attaches whatever session token it holds to every request
     * {@code api/client.js} makes — and that module reads ANY 401 on a token-bearing request as
     * "your session expired", clearing the token and force-navigating to /login with no per-route
     * opt-out. So a signed-in person who opened a stale, already-used or mistyped invite link was
     * thrown out of their own working session and never even saw this sentence, which
     * {@code JoinPage}'s catch had already been replaced by a redirect. Exactly the shape of
     * {@code docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md}: a second
     * credential failing says nothing about the session that carried the request.
     *
     * <p>The invariant this must preserve is about the SENTENCE, not the number — that a bad-link
     * holder cannot tell which part failed — and that is unchanged.
     */
    private static ForbiddenException rejected() {
        return new ForbiddenException("That invitation link is no longer valid. Ask for a new one.");
    }

    private String generateToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String normalise(String email) {
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("An email address is required to send an invite");
        }
        return email.trim().toLowerCase();
    }
}
