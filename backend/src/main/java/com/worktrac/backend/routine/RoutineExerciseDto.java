package com.worktrac.backend.routine;

import java.math.BigDecimal;

/**
 * One exercise in a routine, with whatever the trainer prescribed for it.
 *
 * <p>⚠️ All three target fields are null together or set together — see
 * {@code RoutineExercise.setTarget} and {@code CK_routine_exercises_target_unit}. A consumer must
 * treat a null {@code targetWeight} as "no target at all" rather than as "zero", and must never
 * render a weight without its unit.
 *
 * <p><b>A prescription, not a limit.</b> Nothing validates a logged set against these numbers, and
 * nothing should: a client who lifts more than prescribed has had a good day, not made a mistake.
 */
public record RoutineExerciseDto(Long exerciseId, String exerciseName,
                                 BigDecimal targetWeight, Integer targetReps, String targetUnit) {

    public static RoutineExerciseDto from(RoutineExercise routineExercise) {
        return new RoutineExerciseDto(
                routineExercise.getExercise().getId(),
                routineExercise.getExercise().getName(),
                routineExercise.getTargetWeight(),
                routineExercise.getTargetReps(),
                routineExercise.getTargetUnit());
    }
}
