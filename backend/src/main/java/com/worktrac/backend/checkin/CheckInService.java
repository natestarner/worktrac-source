package com.worktrac.backend.checkin;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.MemberPersonName;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Check-ins: dated entries about a person, some of which a trainer keeps to themselves.
 *
 * <p>⚠️ <b>"Staff" here means {@code WRITE_OTHER_PEOPLE}, never {@code VIEW_OTHER_PEOPLE}.</b> The
 * difference decides who reads a private note, and picking the wrong one is not obvious from the
 * name: on a family account with visibility ON, every MEMBER holds {@code VIEW_OTHER_PEOPLE} — so
 * gating on it would show a teenager whatever their parent wrote privately about their sibling.
 * Only OWNER and MANAGER hold {@code WRITE_OTHER_PEOPLE}, which is exactly the set that should see
 * a private observation.
 */
@Service
public class CheckInService {

    private final CheckInRepository checkInRepository;
    private final PersonService personService;
    private final AccountMembershipRepository membershipRepository;
    private final Clock clock;

    public CheckInService(CheckInRepository checkInRepository, PersonService personService,
                          AccountMembershipRepository membershipRepository, Clock clock) {
        this.checkInRepository = checkInRepository;
        this.personService = personService;
        this.membershipRepository = membershipRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CheckInDto> list(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        List<CheckIn> entries = checkInRepository.findVisibleTo(person.getId(), isStaff(access));

        // One lookup for every author name, before the mapping loop -- the same batching rule
        // RoutineService.list and ExerciseAttributionResolver follow. Skipped entirely when nothing
        // here has an author to name.
        Map<Long, String> nameByUserId = entries.stream().anyMatch(c -> c.getAuthorUserId() != null)
                ? membershipRepository.findPersonNamesByUser(access.accountId()).stream()
                        .collect(Collectors.toMap(MemberPersonName::userId, MemberPersonName::personName,
                                (first, second) -> first))
                : Map.of();

        return entries.stream()
                .map(entry -> CheckInDto.from(entry,
                        entry.getAuthorUserId() == null ? null : nameByUserId.get(entry.getAuthorUserId()),
                        access.userId()))
                .toList();
    }

    @Transactional
    public CheckInDto add(AccountAccess access, Long personId, CheckInRequest request) {
        Person person = personService.requireWritablePerson(personId, access);
        String note = trimToNull(request.note());

        // ⚠️ REFUSED HERE RATHER THAN LEFT TO THE DATABASE. CK_check_ins_has_content would make an
        // empty entry a constraint violation -> 500, which shouldRetryWrite treats as TRANSIENT --
        // so a durable write of nothing would retry forever and wedge the single serial outbox
        // scope behind it, taking every later write with it.
        //
        // A 400 discards it, and that is the right outcome here rather than a loss: an entry with
        // neither a weight nor a note records nothing, so there is nothing to lose. This is the
        // narrow case backend-core.md means by "reject only what is genuinely impossible".
        if (request.bodyWeight() == null && note == null) {
            throw new IllegalArgumentException("A check-in needs a weight or something written down.");
        }

        Instant now = clock.instant();

        return CheckInDto.from(checkInRepository.save(new CheckIn(
                person,
                access.userId(),
                request.enteredAt() == null ? now : request.enteredAt(),
                request.bodyWeight(),
                request.bodyWeightUnit(),
                note,
                resolveVisibility(access, request),
                now)), null, access.userId());
    }

    /**
     * Deletes one of this person's check-ins.
     *
     * <p>Staff may delete any of them; anybody else may delete only what they wrote themselves. A
     * client removing their own weigh-in is ordinary tidying; a client deleting a trainer's
     * observation about them is not, and the trainer would never know it had happened.
     */
    @Transactional
    public void remove(AccountAccess access, Long personId, Long checkInId) {
        Person person = personService.requireWritablePerson(personId, access);
        CheckIn entry = checkInRepository.findByIdAndPerson_Id(checkInId, person.getId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that check-in."));

        // 404 rather than 403 for somebody else's entry, matching the person guards: a caller must
        // not be able to learn that a private note exists by being refused differently.
        if (!isStaff(access) && !access.userId().equals(entry.getAuthorUserId())) {
            throw new NotFoundException("We couldn't find that check-in.");
        }
        checkInRepository.delete(entry);
    }

    /**
     * ⚠️ A person can never make an entry invisible to THEMSELVES.
     *
     * <p>Two reasons, and the second is the one that matters. It is meaningless — they are looking
     * at it as they write it. And a client who could create private entries on their own person
     * would have somewhere in the app their trainer can read but they cannot un-write, which is a
     * confessional the product never offered and cannot support.
     *
     * <p>So visibility is honoured only from a caller acting on somebody else. Silently forced
     * rather than refused: this is a durable write, and a definitive 4xx would discard it entirely
     * rather than saving a check-in whose visibility was already the only correct value.
     */
    private boolean resolveVisibility(AccountAccess access, CheckInRequest request) {
        if (!isStaff(access)) {
            return true;
        }
        return request.visibleToPerson() == null || request.visibleToPerson();
    }

    private boolean isStaff(AccountAccess access) {
        return access.has(Permission.WRITE_OTHER_PEOPLE);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
