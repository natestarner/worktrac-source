package com.worktrac.backend.routine;

import java.time.Instant;
import java.util.List;

/**
 * A routine, and — when somebody else put it there — who.
 *
 * <p>{@code assignedByName} is a NAME and nothing more, exactly like {@code MembershipDto.ownerName}
 * and {@code ExerciseDto.createdByName}. It answers "where did this come from?" on the client's own
 * Routines list, which is what makes a program feel assigned rather than mysteriously present.
 *
 * <p>⚠️ <b>Null is legitimate and must render as naming nobody.</b> Three ways it happens: the
 * routine was built by the person themselves (the overwhelming majority), the assigning login has
 * since been removed ({@code ON DELETE SET NULL} — a client keeps the program they are following),
 * or the assigner has no person in this account to take a name from. Never print "null", and never
 * infer "self-made" from a null name alone — check {@code assignedAt}.
 */
public record RoutineDto(Long id, String name, List<RoutineExerciseDto> exercises,
                         String assignedByName, Instant assignedAt) {

    /**
     * ⚠️ Leaves {@code assignedByName} null. Resolving a user id to a name is a query, and this is
     * called once per routine in a list — see {@code RoutineService.list}, which resolves every name
     * in ONE lookup and fills them in afterwards. A convenience overload that took a repository
     * would put that query back inside the loop.
     */
    public static RoutineDto from(Routine routine) {
        return from(routine, null);
    }

    public static RoutineDto from(Routine routine, String assignedByName) {
        return new RoutineDto(
                routine.getId(),
                routine.getName(),
                routine.getExercises().stream().map(RoutineExerciseDto::from).toList(),
                assignedByName,
                routine.getAssignedAt());
    }
}
