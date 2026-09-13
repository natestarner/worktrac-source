package com.worktrac.backend.exercise;

import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.MemberPersonName;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Resolves {@link ExerciseAttribution} for a whole list in a bounded number of queries.
 *
 * <p>⚠️ THE BATCHING IS THE POINT. {@code ExerciseService.list} maps every exercise visible to an
 * account, so asking either question per row is an N+1 across several hundred rows. Both lookups
 * happen once, before the mapping loop — keep every call to this OUTSIDE the {@code .stream()}.
 *
 * <p>At most two queries, and often fewer:
 * <ul>
 *   <li>creator names — always, one query;
 *   <li>"used by somebody else" — skipped entirely for an owner (exempt via
 *       {@code EDIT_ANY_SHARED_RESOURCE}) and for a list with no household-owned rows.
 * </ul>
 *
 * <p>This deliberately MIRRORS {@code ExerciseService.update}'s three gates rather than sharing code
 * with them. The service keeps refusing on its own terms — it is still the authority, and the client
 * fails open on an absent flag — so if these two ever disagree the write is refused and the person
 * sees the server's own message. That is the safe direction, and MemberPermissionsTest pins both.
 */
@Component
public class ExerciseAttributionResolver {

    private final AccountMembershipRepository membershipRepository;
    private final WorkoutSetRepository workoutSetRepository;

    public ExerciseAttributionResolver(AccountMembershipRepository membershipRepository,
                                       WorkoutSetRepository workoutSetRepository) {
        this.membershipRepository = membershipRepository;
        this.workoutSetRepository = workoutSetRepository;
    }

    public Map<Long, ExerciseAttribution> resolve(AccountAccess access, List<Exercise> exercises) {
        Map<Long, String> namesByUser =
                MemberPersonName.toMap(membershipRepository.findPersonNamesByUser(access.accountId()));

        // The owner holds EDIT_ANY_SHARED_RESOURCE and is exempt from the in-use gate, which is
        // load-bearing rather than incidental: they are the remedy the refusal points at.
        boolean exemptFromInUse = access.has(Permission.EDIT_ANY_SHARED_RESOURCE);

        // ⚠️ A member with no self person fails CLOSED on everything. requireSelfPersonId() throws
        // on the write path precisely because a null person makes `person_id <> ?` match every row
        // and report "used by nobody" -- waving through the rename the check exists to refuse. A
        // list read must not throw, so it answers "not renamable" instead. Same direction
        // mayEditSharedResource already takes on a null creator stamp.
        boolean canJudgeInUse = exemptFromInUse || access.selfPersonId() != null;

        Set<Long> usedByOthers = exemptFromInUse || !canJudgeInUse
                ? Set.of()
                : findUsedByOthers(exercises, access.selfPersonId());

        Map<Long, ExerciseAttribution> byExerciseId = new HashMap<>();
        for (Exercise exercise : exercises) {
            byExerciseId.put(exercise.getId(),
                    attribute(exercise, access, namesByUser, exemptFromInUse, canJudgeInUse, usedByOthers));
        }
        return byExerciseId;
    }

    /** The one-row form, for the create/rename responses. Same answers, same two queries. */
    public ExerciseAttribution resolveOne(AccountAccess access, Exercise exercise) {
        return resolve(access, List.of(exercise)).get(exercise.getId());
    }

    // Only the household's OWN rows are asked about: a global exercise is never renamable by
    // anyone, so including the ~200 preloaded rows would grow the IN clause for answers nothing
    // reads. An empty set short-circuits rather than issuing an empty IN.
    private Set<Long> findUsedByOthers(List<Exercise> exercises, Long selfPersonId) {
        Set<Long> householdIds = new HashSet<>();
        for (Exercise exercise : exercises) {
            if (!exercise.isGlobal() && exercise.getId() != null) {
                householdIds.add(exercise.getId());
            }
        }
        if (householdIds.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(workoutSetRepository.findIdsUsedByAnotherPerson(householdIds, selfPersonId));
    }

    private ExerciseAttribution attribute(Exercise exercise, AccountAccess access,
                                          Map<Long, String> namesByUser, boolean exemptFromInUse,
                                          boolean canJudgeInUse, Set<Long> usedByOthers) {
        if (exercise.isGlobal()) {
            return ExerciseAttribution.GLOBAL;
        }
        Long createdBy = exercise.getCreatedByUserId();
        String createdByName = createdBy == null ? null : namesByUser.get(createdBy);
        boolean createdByYou = createdBy != null && createdBy.equals(access.userId());

        // The same three gates ExerciseService.update applies, in the same order: not global
        // (handled above), mine-or-owner, and nobody else has logged against it.
        boolean renamable = access.mayEditSharedResource(createdBy)
                && canJudgeInUse
                && (exemptFromInUse || !usedByOthers.contains(exercise.getId()));

        return new ExerciseAttribution(createdByName, createdByYou, renamable);
    }
}
