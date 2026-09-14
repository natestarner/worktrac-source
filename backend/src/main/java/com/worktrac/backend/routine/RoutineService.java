package com.worktrac.backend.routine;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.exercise.PersonExerciseService;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.MemberPersonName;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.quota.QuotaService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class RoutineService {

    private final RoutineRepository routineRepository;
    private final ExerciseRepository exerciseRepository;
    private final PersonService personService;
    private final PersonExerciseService personExerciseService;
    private final QuotaService quotaService;
    private final AccountMembershipRepository membershipRepository;
    private final Clock clock;

    public RoutineService(RoutineRepository routineRepository, ExerciseRepository exerciseRepository,
                           PersonService personService, PersonExerciseService personExerciseService,
                           QuotaService quotaService, AccountMembershipRepository membershipRepository,
                           Clock clock) {
        this.routineRepository = routineRepository;
        this.exerciseRepository = exerciseRepository;
        this.personService = personService;
        this.personExerciseService = personExerciseService;
        this.quotaService = quotaService;
        this.membershipRepository = membershipRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<RoutineDto> list(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        List<Routine> routines = routineRepository.findByPerson_IdOrderBySortOrderAscIdAsc(person.getId());

        // ⚠️ ONE lookup for every assigner name, resolved BEFORE the mapping loop. Asking per
        // routine would be an N+1 on a list a client opens constantly -- the same rule
        // ExerciseAttributionResolver follows for the catalogue, and the reason RoutineDto.from's
        // one-argument overload leaves the name null rather than offering to fetch it.
        //
        // Skipped entirely when nothing here was assigned, which is every family household.
        Map<Long, String> nameByUserId = routines.stream().anyMatch(r -> r.getAssignedByUserId() != null)
                ? membershipRepository.findPersonNamesByUser(access.accountId()).stream()
                        .collect(Collectors.toMap(MemberPersonName::userId, MemberPersonName::personName,
                                (first, second) -> first))
                : Map.of();

        return routines.stream()
                .map(routine -> RoutineDto.from(routine,
                        routine.getAssignedByUserId() == null
                                ? null
                                : nameByUserId.get(routine.getAssignedByUserId())))
                .toList();
    }

    @Transactional
    public RoutineDto create(AccountAccess access, Long personId, RoutineRequest request) {
        Person person = personService.requireWritablePerson(personId, access);
        quotaService.requireRoutineCapacity(access.accountId(), person.getId(),
                routineRepository.countByPerson_Id(person.getId()));
        Routine routine = new Routine(person, request.name().trim());
        routine.setSortOrder(nextSortOrder(person));
        applyExercises(access.accountId(), person, routine, request.exercises());
        return RoutineDto.from(routineRepository.save(routine));
    }

    @Transactional
    public RoutineDto update(AccountAccess access, Long personId, Long routineId, RoutineRequest request) {
        Person person = personService.requireWritablePerson(personId, access);
        Routine routine = routineRepository.findByIdAndPerson_Id(routineId, person.getId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that routine."));
        routine.setName(request.name().trim());
        routine.getExercises().clear();
        applyExercises(access.accountId(), person, routine, request.exercises());
        return RoutineDto.from(routine);
    }

    @Transactional
    public void delete(AccountAccess access, Long personId, Long routineId) {
        Person person = personService.requireWritablePerson(personId, access);
        Routine routine = routineRepository.findByIdAndPerson_Id(routineId, person.getId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that routine."));
        routineRepository.delete(routine);
    }

    @Transactional
    public List<RoutineDto> copy(AccountAccess access, Long personId, Long routineId, CopyRoutineRequest request) {
        Person sourcePerson = personService.requireVisiblePerson(personId, access);
        Routine source = routineRepository.findByIdAndPerson_Id(routineId, sourcePerson.getId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that routine."));

        // Exercise visibility is account-scoped, not person-scoped, so resolve it once
        // and reuse the same list for every target person instead of re-validating per target.
        List<Exercise> exercises = resolveVisibleExercises(access.accountId(),
                source.getExercises().stream().map(re -> re.getExercise().getId()).toList());

        List<RoutineDto> copies = new ArrayList<>();
        for (Long targetPersonId : request.targetPersonIds()) {
            Person target = personService.requireWritablePerson(targetPersonId, access);
            Routine copy = new Routine(target, source.getName());
            // The target's tail, not the source's -- a copy lands at the end of the list it is
            // arriving in. Re-read per target because each one has its own numbering, and
            // because copying to the same person twice must not reuse a position.
            copy.setSortOrder(nextSortOrder(target));
            attachExercises(copy, exercises);
            copyTargets(source, copy);

            // ⚠️ PROVENANCE, RATHER THAN A SECOND "assign" OPERATION. Copying a routine onto
            // somebody else and assigning a program to a client are the same act; only the
            // vocabulary differs. A parallel assign() would have been a second way to do an
            // existing job -- exactly what resilience.md's mechanism table exists to prevent --
            // and the two would have drifted on ordering, favouriting and exercise visibility.
            //
            // Stamped only when the copy lands on somebody ELSE. A person duplicating their own
            // routine has not been assigned anything, and recording otherwise would have their own
            // Routines list claim a trainer put it there.
            if (!access.isSelf(target.getId())) {
                copy.markAssignedBy(access.userId(), clock.instant());
            }

            copies.add(RoutineDto.from(routineRepository.save(copy)));
            favorite(target, exercises);
        }
        return copies;
    }

    // Rewrites the person's whole arrangement in one shot. The request must name every one of
    // their routines exactly once: a partial list has no correct answer (the omitted routines
    // would keep positions that now collide), and silently renumbering around it is worse than
    // refusing. IllegalArgumentException is a 400, which is terminal -- correct here, since this
    // is an online-gated write with no outbox behind it to retry.
    @Transactional
    public List<RoutineDto> reorder(AccountAccess access, Long personId, ReorderRoutinesRequest request) {
        Person person = personService.requireWritablePerson(personId, access);
        List<Routine> existing = routineRepository.findByPerson_IdOrderBySortOrderAscIdAsc(person.getId());

        Map<Long, Routine> byId = new HashMap<>();
        for (Routine routine : existing) {
            byId.put(routine.getId(), routine);
        }
        Set<Long> requested = new LinkedHashSet<>(request.routineIds());
        if (requested.size() != request.routineIds().size() || !requested.equals(byId.keySet())) {
            throw new IllegalArgumentException("That list of routines doesn't match this person's routines.");
        }

        int position = 0;
        List<RoutineDto> reordered = new ArrayList<>();
        for (Long routineId : request.routineIds()) {
            Routine routine = byId.get(routineId);
            routine.setSortOrder(position++);
            reordered.add(RoutineDto.from(routine));
        }
        return reordered;
    }

    // Zero-based and append-only. Reorder is the only thing that ever renumbers, so positions can
    // go sparse after a delete -- which is harmless, since nothing reads them but ORDER BY.
    private int nextSortOrder(Person person) {
        return routineRepository.findFirstByPerson_IdOrderBySortOrderDesc(person.getId())
                .map(routine -> routine.getSortOrder() + 1)
                .orElse(0);
    }

    private void applyExercises(Long accountId, Person person, Routine routine,
                                List<RoutineExerciseRequest> requested) {
        List<Exercise> exercises = resolveVisibleExercises(accountId,
                requested.stream().map(RoutineExerciseRequest::exerciseId).toList());
        attachExercises(routine, exercises);

        // ⚠️ Applied by POSITION, matching the order resolveVisibleExercises preserved. Not by
        // exercise id: the same exercise may legitimately appear twice in one routine (a top set
        // and a back-off set at different numbers), and matching by id would give both the first
        // one's target.
        List<RoutineExercise> attached = routine.getExercises();
        for (int i = 0; i < attached.size() && i < requested.size(); i++) {
            RoutineExerciseRequest target = requested.get(i);
            attached.get(i).setTarget(
                    target.hasWeightTarget() ? target.targetWeight() : null,
                    target.targetReps(),
                    target.targetUnit());
        }

        favorite(person, exercises);
    }

    // An exercise placed in a routine auto-favorites for that routine's person, so it shows in
    // their Log picker without a separate favoriting step (matches the V24 backfill).
    private void favorite(Person person, List<Exercise> exercises) {
        exercises.forEach(exercise -> personExerciseService.ensureFavorite(person, exercise));
    }

    // ONE query for the whole list, not one per id. This used to loop findById, so a routine
    // request carrying N exercise ids issued N selects inside a single transaction -- and with no
    // cap on the list (now @Size(max = 100) on RoutineRequest) that was an easy way for one
    // authenticated request to hold a connection from a pool of 10 while it ran thousands of
    // statements. A saturated pool makes every OTHER household's requests queue past the client's
    // 15s abort, which an aborted fetch reports as lie-fi -- so one abuser degraded everyone.
    //
    // Semantics are deliberately unchanged: any id that is unknown OR belongs to another account
    // is still an indistinguishable 404, and the caller's ORDER is preserved (it defines the order
    // a routine is stepped through), which is why this maps over the requested ids rather than
    // returning whatever order the database handed back.
    private List<Exercise> resolveVisibleExercises(Long accountId, List<Long> exerciseIds) {
        Map<Long, Exercise> visibleById = new HashMap<>();
        for (Exercise exercise : exerciseRepository.findAllById(exerciseIds)) {
            if (exercise.isGlobal() || exercise.getAccount().getId().equals(accountId)) {
                visibleById.put(exercise.getId(), exercise);
            }
        }
        List<Exercise> resolved = new ArrayList<>();
        for (Long exerciseId : exerciseIds) {
            Exercise exercise = visibleById.get(exerciseId);
            if (exercise == null) {
                throw new NotFoundException("We couldn't find that exercise.");
            }
            resolved.add(exercise);
        }
        return resolved;
    }

    private void attachExercises(Routine routine, List<Exercise> exercises) {
        int order = 0;
        for (Exercise exercise : exercises) {
            routine.getExercises().add(new RoutineExercise(routine, exercise, order++));
        }
    }

    /**
     * Copies the source routine's prescribed targets onto a fresh copy, position by position.
     *
     * <p>⚠️ Matched by SORT ORDER rather than by exercise id, because the same exercise may appear
     * twice in one routine (a top set and a back-off set, at different numbers) and matching by id
     * would give both the first one's target.
     *
     * <p>Copying targets is what makes assigning a program mean anything: a template whose numbers
     * did not travel would arrive as a bare list of exercise names.
     */
    private void copyTargets(Routine source, Routine copy) {
        List<RoutineExercise> from = source.getExercises();
        List<RoutineExercise> to = copy.getExercises();
        for (int i = 0; i < to.size() && i < from.size(); i++) {
            RoutineExercise original = from.get(i);
            to.get(i).setTarget(original.getTargetWeight(), original.getTargetReps(), original.getTargetUnit());
        }
    }
}
