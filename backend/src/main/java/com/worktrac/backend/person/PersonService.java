package com.worktrac.backend.person;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.quota.QuotaService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PersonService {

    // Kept identical for both "not in this account" and "in this account but you cannot see them",
    // so a member can never use the difference to enumerate the household they're in.
    private static final String NOT_FOUND = "We couldn't find that person.";

    private final PersonRepository personRepository;
    private final AccountRepository accountRepository;
    private final QuotaService quotaService;

    public PersonService(PersonRepository personRepository, AccountRepository accountRepository,
                          QuotaService quotaService) {
        this.personRepository = personRepository;
        this.accountRepository = accountRepository;
        this.quotaService = quotaService;
    }

    // ── THE TWO GUARDS ────────────────────────────────────────────────────────────────────────
    //
    // These replace requireOwnedPerson, which asked only "is this person in my account?". That was
    // the whole authorization boundary while an account had exactly one login; with member logins
    // it is half the question, because the other member of my household is in my account too.
    //
    // ⚠️ THE RENAME IS THE POINT. requireOwnedPerson was deleted rather than kept as a delegating
    // shim, so all 36 call sites became compile errors and each had to be classified read-vs-write
    // by hand. A shim would have let any site silently keep the permissive behaviour, and the
    // failure mode of getting one wrong is invisible: the endpoint keeps working, for everyone.
    // For the same reason, neither new name is the old one -- so a rebase or a stale branch that
    // reintroduces `requireOwnedPerson` fails to compile instead of quietly reopening the hole.
    //
    // STATUS CHOICE, and it is deliberate in both directions:
    //   not in this account, or not visible -> 404, so "doesn't exist" and "not yours" stay
    //                                          indistinguishable (the pre-existing property).
    //   visible but not writable            -> 403, because a 404 there is a lie the UI would
    //                                          immediately contradict -- the member is looking at
    //                                          the person's name on screen while being told they
    //                                          don't exist.

    /** Loads a person the caller is allowed to READ. 404 if they are not in the account or not visible. */
    @Transactional(readOnly = true)
    public Person requireVisiblePerson(Long personId, AccountAccess access) {
        Person person = personRepository.findByIdAndAccount_Id(personId, access.accountId())
                .orElseThrow(() -> new NotFoundException(NOT_FOUND));
        return requireVisiblePerson(person, access, NOT_FOUND);
    }

    /** Loads a person the caller is allowed to WRITE. 404 if not visible, 403 if visible but not theirs. */
    @Transactional(readOnly = true)
    public Person requireWritablePerson(Long personId, AccountAccess access) {
        Person person = personRepository.findByIdAndAccount_Id(personId, access.accountId())
                .orElseThrow(() -> new NotFoundException(NOT_FOUND));
        return requireWritablePerson(person, access, NOT_FOUND);
    }

    /**
     * Permission-only check for a person already loaded through an account-scoped finder.
     *
     * <p>This is what the child-id endpoints use -- PATCH /api/sets/{setId} and friends, which
     * never see a personId and prove tenancy by walking the FK chain up to the account instead.
     * Those finders already answered "is this row in my account?"; this answers the half they
     * cannot. The caller passes its OWN not-found message, because from the caller's side the
     * thing that doesn't exist is the set or the session, not the person behind it.
     */
    public Person requireVisiblePerson(Person person, AccountAccess access, String notFoundMessage) {
        if (access.has(Permission.VIEW_OTHER_PEOPLE) || access.isSelf(person.getId())) {
            return person;
        }
        throw new NotFoundException(notFoundMessage);
    }

    /** Write counterpart of the above, for a person already loaded by an account-scoped finder. */
    public Person requireWritablePerson(Person person, AccountAccess access, String notFoundMessage) {
        // Not visible at all -> the caller must not learn this row exists.
        if (!access.has(Permission.VIEW_OTHER_PEOPLE) && !access.isSelf(person.getId())) {
            throw new NotFoundException(notFoundMessage);
        }
        if (access.has(Permission.WRITE_OTHER_PEOPLE) || access.isSelf(person.getId())) {
            return person;
        }
        throw new ForbiddenException("You can only change your own workouts.");
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────────────────────

    /**
     * The people this login may see — everyone in the household, or just themselves.
     *
     * <p>This is the single source of "who exists" for the whole client: the person pill bar, the
     * Profile page and cache warming all read it. Filtering HERE rather than at each of those means
     * a member cannot learn who else is in the household from any of them, and a screen that
     * forgets to filter cannot exist.
     *
     * <p>A member with no person attached sees an empty list rather than everyone. That is the
     * fail-closed direction, and `NoActivePersonScreen` handles it as a real state.
     */
    @Transactional(readOnly = true)
    public List<PersonDto> list(AccountAccess access) {
        return personRepository.findByAccount_IdOrderByCreatedAtAsc(access.accountId()).stream()
                .filter(person -> access.has(Permission.VIEW_OTHER_PEOPLE) || access.isSelf(person.getId()))
                .map(PersonDto::from)
                .toList();
    }

    @Transactional
    public PersonDto add(AccountAccess access, String name) {
        Long accountId = access.accountId();
        quotaService.requirePersonCapacity(accountId, personRepository.countByAccount_Id(accountId));
        Account account = accountRepository.getReferenceById(accountId);
        Person person = personRepository.save(new Person(account, name.trim(), false));
        return PersonDto.from(person);
    }

    // Writable, not MANAGE_PEOPLE: renaming yourself is something a member may do. Renaming
    // SOMEONE ELSE needs WRITE_OTHER_PEOPLE, which only an owner holds -- so one guard covers both
    // cases without the controller needing to know which one it is.
    @Transactional
    public PersonDto rename(AccountAccess access, Long personId, String name) {
        Person person = requireWritablePerson(personId, access);
        person.setName(name.trim());
        return PersonDto.from(person);
    }

    // Same reasoning as rename: the rest timer is a per-person training preference, and a member
    // turning their own off mid-workout must not need the owner.
    @Transactional
    public PersonDto setRestTimerEnabled(AccountAccess access, Long personId, boolean enabled) {
        Person person = requireWritablePerson(personId, access);
        person.setRestTimerEnabled(enabled);
        return PersonDto.from(person);
    }

    // Visible rather than writable: removing a person deletes their entire training history, so it
    // is gated by MANAGE_PEOPLE at the controller (owner only) rather than by write access to that
    // person. A member must not be able to delete themselves and take their own history with them.
    @Transactional
    public void remove(AccountAccess access, Long personId) {
        Person person = requireVisiblePerson(personId, access);
        if (person.isPrimary()) {
            throw new ConflictException("Cannot remove the primary person on an account");
        }
        personRepository.delete(person);
    }
}
