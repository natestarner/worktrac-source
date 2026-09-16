package com.worktrac.backend.routine;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.math.BigDecimal;

/**
 * One exercise in a routine, with an optional prescribed target.
 *
 * <p>⚠️ This replaced a bare {@code Long} in {@code RoutineRequest}, and the reason is data loss
 * rather than expressiveness. {@code update} clears a routine's exercises and rebuilds them from the
 * request, so a request that could not express a target would destroy every target on the routine
 * each time a trainer renamed it or reordered a single exercise — silently, with the numbers simply
 * gone the next time the client opened their program.
 *
 * <p><b>The request is therefore the whole truth about the routine.</b> A client that reads targets
 * must send them back. Omitting them means "no target", not "leave what was there".
 *
 * <p>Validation is deliberately loose about what a target IS — a prescription is not a limit, and
 * nothing validates a logged set against it. What is enforced is only that the number is
 * interpretable: a weight needs a unit ({@code CK_routine_exercises_target_unit} backs this up at
 * the database), and zero or negative reps are a typo rather than a prescription.
 */
public record RoutineExerciseRequest(
        @NotNull Long exerciseId,
        @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal targetWeight,
        @Min(value = 1, message = "must be 1 or greater") Integer targetReps,
        @Pattern(regexp = "lb|kg", message = "must be lb or kg") String targetUnit) {

    /** True when this carries a weight the client can actually render. */
    public boolean hasWeightTarget() {
        return targetWeight != null && targetUnit != null;
    }
}
